-- Supabase schema for the flockwatch persistence layer.
-- Replaces Deno KV as the backing store for src/state/store.ts.
-- Keys are JSON-encoded string arrays (e.g. '["players","abc"]') so they
-- round-trip exactly; prefix listing uses an escaped LIKE match.

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz
);

-- Read a single key, treating expired rows as absent.
create or replace function kv_get(k text)
returns jsonb
language sql
stable
as $$
  select value from kv_store
  where key = k
    and (expires_at is null or expires_at > now());
$$;

-- Upsert a key.
create or replace function kv_set(k text, v jsonb)
returns void
language sql
as $$
  insert into kv_store (key, value, expires_at)
  values (k, v, null)
  on conflict (key) do update
    set value = excluded.value,
        expires_at = excluded.expires_at;
$$;

-- Set only if absent (or expired), with optional TTL in milliseconds.
-- Matches the atomic check-and-set semantics of Deno KV's setIfAbsent.
create or replace function kv_set_if_absent(k text, v jsonb, expire_ms bigint default null)
returns boolean
language plpgsql
as $$
begin
  -- An expired row counts as absent.
  delete from kv_store
  where key = k
    and expires_at is not null
    and expires_at <= now();
  insert into kv_store (key, value, expires_at)
  values (
    k,
    v,
    case when expire_ms is null then null
         else now() + make_interval(secs => expire_ms / 1000.0) end
  )
  on conflict (key) do nothing;
  return found;
end;
$$;

create or replace function kv_delete(k text)
returns void
language sql
as $$
  delete from kv_store where key = k;
$$;

-- Bulk upsert, used by tools/migrate_to_supabase.ts.
-- rows: jsonb array of { "k": key, "v": value }.
create or replace function kv_set_many(rows jsonb)
returns void
language sql
as $$
  insert into kv_store (key, value)
  select r ->> 'k', r -> 'v'
  from jsonb_array_elements(rows) as r
  on conflict (key) do update set value = excluded.value;
$$;

-- List all live entries whose key starts with the given JSON prefix.
-- Prefix is a JSON array fragment like '["npcs",' produced by the client.
create or replace function kv_list(prefix text)
returns table (key text, value jsonb)
language sql
stable
as $$
  select key, value from kv_store
  where key like
    replace(replace(replace(prefix, '\', '\\'), '%', '\%'), '_', '\_')
    || '%' escape '\'
    and (expires_at is null or expires_at > now())
  order by key;
$$;

-- The server connects with the service role key, which bypasses RLS.
-- Enable RLS anyway so anon/authenticated roles can never read game state.
alter table kv_store enable row level security;
