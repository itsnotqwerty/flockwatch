/**
 * Persistence layer. The only module that touches storage (design §3.2).
 * Uses Supabase (Postgres) when SUPABASE_URL and a service key are set,
 * Deno KV otherwise, and an in-memory map for tests.
 */

export interface Store {
  get<T>(key: string[]): Promise<T | null>;
  set<T>(key: string[], value: T): Promise<void>;
  setIfAbsent<T>(
    key: string[],
    value: T,
    expireIn?: number,
  ): Promise<boolean>;
  delete(key: string[]): Promise<void>;
  list<T>(prefix: string[]): Promise<Array<{ key: string[]; value: T }>>;
  close(): void;
}

/** In-memory store for tests and offline development. */
export function createMemoryStore(): Store {
  const map = new Map<string, unknown>();
  const encode = (key: string[]) => key.join("");
  return {
    get<T>(key: string[]): Promise<T | null> {
      const v = map.get(encode(key));
      return Promise.resolve(v === undefined ? null : (v as T));
    },
    set<T>(key: string[], value: T): Promise<void> {
      map.set(encode(key), value);
      return Promise.resolve();
    },
    setIfAbsent<T>(key: string[], value: T): Promise<boolean> {
      const encoded = encode(key);
      if (map.has(encoded)) return Promise.resolve(false);
      map.set(encoded, value);
      return Promise.resolve(true);
    },
    delete(key: string[]): Promise<void> {
      map.delete(encode(key));
      return Promise.resolve();
    },
    list<T>(prefix: string[]): Promise<Array<{ key: string[]; value: T }>> {
      const p = encode(prefix);
      const out: Array<{ key: string[]; value: T }> = [];
      for (const [k, v] of map) {
        if (k.startsWith(p)) {
          out.push({ key: k.split(""), value: v as T });
        }
      }
      return Promise.resolve(out);
    },
    close() {
      map.clear();
    },
  };
}

/** Deno KV-backed store. */
export function createKvStore(kv: Deno.Kv): Store {
  return {
    async get<T>(key: string[]): Promise<T | null> {
      const entry = await kv.get<T>(key);
      return entry.value;
    },
    async set<T>(key: string[], value: T): Promise<void> {
      await kv.set(key, value);
    },
    async setIfAbsent<T>(
      key: string[],
      value: T,
      expireIn?: number,
    ): Promise<boolean> {
      const result = await kv.atomic()
        .check({ key, versionstamp: null })
        .set(key, value, expireIn === undefined ? undefined : { expireIn })
        .commit();
      return result.ok;
    },
    async delete(key: string[]): Promise<void> {
      await kv.delete(key);
    },
    async list<T>(
      prefix: string[],
    ): Promise<Array<{ key: string[]; value: T }>> {
      const out: Array<{ key: string[]; value: T }> = [];
      for await (const entry of kv.list<T>({ prefix })) {
        out.push({ key: entry.key as string[], value: entry.value });
      }
      return out;
    },
    close() {
      kv.close();
    },
  };
}

let store: Store | null = null;

/**
 * Key encoding for the Supabase table: JSON.stringify preserves segments
 * exactly. A prefix becomes a JSON fragment ('["npcs"]' -> '["npcs",')
 * that matches all its children under LIKE. Exported for tests.
 */
export const encodeKey = (key: string[]): string => JSON.stringify(key);
export const encodePrefix = (prefix: string[]): string =>
  prefix.length === 0
    ? "["
    : JSON.stringify(prefix).replace(/\]$/, ",");

interface SupabaseStoreOptions {
  url: string;
  serviceKey: string;
}

/**
 * Supabase-backed store. Talks to PostgREST RPC functions defined in
 * supabase/schema.sql (kv_get, kv_set, kv_set_if_absent, kv_delete,
 * kv_list). Uses the service role key; the table has RLS enabled.
 */
export function createSupabaseStore(opts: SupabaseStoreOptions): Store {
  const rpc = async (fn: string, body: Record<string, unknown>) => {
    const res = await fetch(`${opts.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "apikey": opts.serviceKey,
        "Authorization": `Bearer ${opts.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `Supabase rpc ${fn} failed: ${res.status} ${await res.text()}`,
      );
    }
    const text = await res.text();
    return text === "" ? null : JSON.parse(text);
  };
  return {
    async get<T>(key: string[]): Promise<T | null> {
      return (await rpc("kv_get", { k: encodeKey(key) })) as T | null;
    },
    async set<T>(key: string[], value: T): Promise<void> {
      await rpc("kv_set", { k: encodeKey(key), v: value });
    },
    async setIfAbsent<T>(
      key: string[],
      value: T,
      expireIn?: number,
    ): Promise<boolean> {
      return (await rpc("kv_set_if_absent", {
        k: encodeKey(key),
        v: value,
        expire_ms: expireIn ?? null,
      })) as boolean;
    },
    async delete(key: string[]): Promise<void> {
      await rpc("kv_delete", { k: encodeKey(key) });
    },
    async list<T>(
      prefix: string[],
    ): Promise<Array<{ key: string[]; value: T }>> {
      const rows = (await rpc("kv_list", {
        prefix: encodePrefix(prefix),
      })) as Array<{ key: string; value: T }>;
      return rows.map((r) => ({
        key: JSON.parse(r.key) as string[],
        value: r.value,
      }));
    },
    close() {
      // PostgREST is stateless; nothing to close.
    },
  };
}

/**
 * Open the shared store. Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SECRET_KEY) are set, KV otherwise, memory when
 * DENO_KV_PATH=memory (used by tests).
 */
export async function openStore(): Promise<Store> {
  if (store) return store;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");
  if (Deno.env.get("DENO_KV_PATH") === "memory") {
    store = createMemoryStore();
  } else if (supabaseUrl && supabaseKey) {
    store = createSupabaseStore({ url: supabaseUrl, serviceKey: supabaseKey });
  } else {
    const kv = await Deno.openKv(Deno.env.get("DENO_KV_PATH") || undefined);
    store = createKvStore(kv);
  }
  return store;
}

/** Inject a store directly (tests). */
export function useStore(s: Store): void {
  store = s;
}
