/**
 * Persistence layer. The only module that touches storage (design §3.2).
 * Uses Deno KV when available, falls back to an in-memory map for tests.
 */

export interface Store {
  get<T>(key: string[]): Promise<T | null>;
  set<T>(key: string[], value: T): Promise<void>;
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
    async delete(key: string[]): Promise<void> {
      await kv.delete(key);
    },
    async list<T>(prefix: string[]): Promise<Array<{ key: string[]; value: T }>> {
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
 * Open the shared store. Uses KV unless DENO_KV_PATH=memory (used by tests).
 */
export async function openStore(): Promise<Store> {
  if (store) return store;
  if (Deno.env.get("DENO_KV_PATH") === "memory") {
    store = createMemoryStore();
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
