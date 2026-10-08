/**
 * Persistence layer. The only module that touches storage (design §3.2).
 * Uses local PostgreSQL in production, Deno KV for legacy development,
 * and an in-memory map for tests.
 */

import postgres from "postgres";

export interface Store {
  get<T>(key: string[]): Promise<T | null>;
  take<T>(key: string[]): Promise<T | null>;
  set<T>(key: string[], value: T): Promise<void>;
  setIfAbsent<T>(
    key: string[],
    value: T,
    expireIn?: number,
  ): Promise<boolean>;
  delete(key: string[]): Promise<void>;
  list<T>(prefix: string[]): Promise<Array<{ key: string[]; value: T }>>;
  close(): void | Promise<void>;
}

/** In-memory store for tests and offline development. */
export function createMemoryStore(): Store {
  const map = new Map<
    string,
    { key: string[]; value: unknown; expiresAt: number | null }
  >();
  const encode = (key: string[]) => encodeKey(key);
  const liveEntry = (encoded: string) => {
    const entry = map.get(encoded);
    if (
      entry?.expiresAt !== null && entry?.expiresAt !== undefined &&
      entry.expiresAt <= Date.now()
    ) {
      map.delete(encoded);
      return undefined;
    }
    return entry;
  };
  return {
    get<T>(key: string[]): Promise<T | null> {
      const entry = liveEntry(encode(key));
      return Promise.resolve(entry === undefined ? null : (entry.value as T));
    },
    take<T>(key: string[]): Promise<T | null> {
      const entry = liveEntry(encode(key));
      map.delete(encode(key));
      return Promise.resolve(entry === undefined ? null : (entry.value as T));
    },
    set<T>(key: string[], value: T): Promise<void> {
      map.set(encode(key), { key: [...key], value, expiresAt: null });
      return Promise.resolve();
    },
    setIfAbsent<T>(
      key: string[],
      value: T,
      expireIn?: number,
    ): Promise<boolean> {
      const encoded = encode(key);
      if (liveEntry(encoded)) return Promise.resolve(false);
      map.set(encoded, {
        key: [...key],
        value,
        expiresAt: expireIn === undefined ? null : Date.now() + expireIn,
      });
      return Promise.resolve(true);
    },
    delete(key: string[]): Promise<void> {
      map.delete(encode(key));
      return Promise.resolve();
    },
    list<T>(prefix: string[]): Promise<Array<{ key: string[]; value: T }>> {
      const out: Array<{ key: string[]; value: T }> = [];
      for (const encoded of [...map.keys()]) {
        const entry = liveEntry(encoded);
        if (
          entry &&
          prefix.every((segment, index) => entry.key[index] === segment)
        ) {
          out.push({ key: [...entry.key], value: entry.value as T });
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
    async take<T>(key: string[]): Promise<T | null> {
      const entry = await kv.get<T>(key);
      if (entry.value === null) return null;
      const result = await kv.atomic().check(entry).delete(key).commit();
      return result.ok ? entry.value : null;
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
 * Key encoding for the database table: JSON.stringify preserves segments
 * exactly. A prefix becomes a JSON fragment ('["npcs"]' -> '["npcs",')
 * that matches all its children under LIKE. Exported for tests.
 */
export const encodeKey = (key: string[]): string => JSON.stringify(key);
export const encodePrefix = (prefix: string[]): string =>
  prefix.length === 0 ? "[" : JSON.stringify(prefix).replace(/\]$/, ",");

export function createPostgresStore(url: string): Store {
  const sql = postgres(url, { max: 5 });
  return {
    async get<T>(key: string[]): Promise<T | null> {
      const [row] = await sql`SELECT value FROM kv_store WHERE key = ${
        encodeKey(key)
      }
        AND (expires_at IS NULL OR expires_at > now())`;
      return row ? row.value as T : null;
    },
    async take<T>(key: string[]): Promise<T | null> {
      const [row] = await sql`DELETE FROM kv_store WHERE key = ${encodeKey(key)}
        AND (expires_at IS NULL OR expires_at > now()) RETURNING value`;
      return row ? row.value as T : null;
    },
    async set<T>(key: string[], value: T): Promise<void> {
      await sql`INSERT INTO kv_store (key, value, expires_at)
        VALUES (${encodeKey(key)}, ${
        sql.json(value as postgres.JSONValue)
      }, NULL)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = NULL`;
    },
    async setIfAbsent<T>(
      key: string[],
      value: T,
      expireIn?: number,
    ): Promise<boolean> {
      const rows = await sql`INSERT INTO kv_store (key, value, expires_at)
        VALUES (${encodeKey(key)}, ${sql.json(value as postgres.JSONValue)},
          CASE WHEN ${expireIn ?? null}::bigint IS NULL THEN NULL
            ELSE now() + ${expireIn ?? 0} * interval '1 millisecond' END)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at
          WHERE kv_store.expires_at <= now()
        RETURNING key`;
      return rows.length === 1;
    },
    async delete(key: string[]): Promise<void> {
      await sql`DELETE FROM kv_store WHERE key = ${encodeKey(key)}`;
    },
    async list<T>(
      prefix: string[],
    ): Promise<Array<{ key: string[]; value: T }>> {
      const encoded = encodePrefix(prefix);
      const rows = await sql`SELECT key, value FROM kv_store
        WHERE (key = ${encodeKey(prefix)} OR starts_with(key, ${encoded}))
          AND (expires_at IS NULL OR expires_at > now()) ORDER BY key`;
      return rows.map((row) => ({
        key: JSON.parse(row.key) as string[],
        value: row.value as T,
      }));
    },
    async close() {
      await sql.end();
    },
  };
}

/**
 * Open the shared store using DATABASE_URL; memory is available for tests.
 */
export async function openStore(): Promise<Store> {
  if (store) return store;
  const databaseUrl = Deno.env.get("DATABASE_URL");
  const production = Deno.env.get("DENO_ENV") === "production" ||
    Deno.env.get("DENO_DEPLOYMENT_ID");
  if (production && !databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
  }
  if (!production && Deno.env.get("DENO_KV_PATH") === "memory") {
    store = createMemoryStore();
  } else if (databaseUrl) {
    store = createPostgresStore(databaseUrl);
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
