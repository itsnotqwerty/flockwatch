# Local PostgreSQL

Run PostgreSQL 16+ and one Deno/systemd game process on the same host. Keep
PostgreSQL on localhost with a dedicated non-superuser role/database. Share the
PostgreSQL server with other apps if desired, not their login roles or databases.
Use HTTPS/nginx publicly, preserve WebSocket upgrades, and keep port 5432 private.

## Provision

Install PostgreSQL using your host package manager. Run as an administrator:

```sh
sudo -u postgres createuser --pwprompt flockwatch
sudo -u postgres createdb --owner=flockwatch flockwatch
```

Configure the service from `.env.example` using `DATABASE_URL` with a URL-encoded
password, `DENO_ENV=production`, HTTPS `MAIL_ORIGIN_URL`, and existing Resend
settings. Export `DATABASE_URL` in the maintenance shell and apply:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

The existing deployment installer supplies the environment to systemd.
`deno task start` uses exported environment variables; `deno task dev` loads
the local environment file. Protect credentials and environment files.

## Import From Supabase

1. Back up the source and stop all game/scheduler writers, including cloud instances.
2. Initialize an empty destination with `db/schema.sql`.
3. Export `SOURCE_DATABASE_URL` for the Supabase direct PostgreSQL connection or
   session-mode pooler, with access to `public.kv_store` and `auth.users`. Use
   verified TLS for the source connection, never disabled certificate checks.
4. Run:

```sh
deno run --allow-env --allow-net tools/import_supabase.ts
```

The importer preserves JSON key/value data and expirations, reads a consistent
source snapshot, and writes one transaction. It refuses non-empty targets and
imports bcrypt password hashes with their original auth user IDs. Unsupported
hashes abort the import. Accounts without passwords can request a reset.
Sessions and legacy auth tokens are excluded: users must sign in again and
request new confirmation/reset links. Characters and progress stay intact.

For older local Deno KV installations, `deno task migrate-from-kv [kv-path]`
copies to an empty PostgreSQL destination. KV does not expose remaining TTLs;
sessions, auth tokens, action-request claims, and lock collections are excluded. If KV
accounts still depend on remote auth, also arrange a credential import before
cutover; a KV-only copy cannot recover password hashes stored in Supabase.

Compare source/destination collections (excluding sessions), log in with an
existing account, check character/world state and multiplayer, then exercise
signup, confirmation, reset, and logout. Switch traffic only after those checks.
Remove `SUPABASE_*` from the local service. Keep the source and backup until
restore testing succeeds; only then retire Supabase. Do not run both writers.
Rollback after new local writes requires a reverse data migration.

## Operations

Passwords use bcrypt (8 characters minimum, 72 UTF-8 bytes maximum). Sessions
last 30 days; confirmation and recovery tokens expire after 30 minutes and can
be consumed once. Signup still starts a session immediately; confirmation links
record email ownership but are not a login gate. Password reset changes the
credential version and invalidates prior sessions and email links.

Schedule off-host `pg_dump -Fc "$DATABASE_URL"` backups, test restores, monitor
disk/database health, and periodically delete expired `kv_store` rows. Do not
bulk-delete `auth_password_changes` records: these protect password-reset races.
Rate-limit auth endpoints at the reverse proxy. Run integration checks in an
isolated initialized database:

```sh
TEST_DATABASE_URL="$DATABASE_URL" deno test -A src/state/store_test.ts
deno task test
```

Historical `supabase/schema.sql` is reference only. Live environment files and
hosted databases were not modified by the code migration.