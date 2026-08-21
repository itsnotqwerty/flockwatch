/**
 * One-shot migration: copy every entry from the local Deno KV database
 * into the Supabase kv_store table.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   deno run --allow-all tools/migrate_to_supabase.ts [kv-path]
 *
 * kv-path defaults to DENO_KV_PATH (or Deno's default KV location).
 * Existing Supabase rows are overwritten. Ephemeral entries (sessions with
 * TTLs) are copied without their expiry — players may need to log in again.
 */
import { encodeKey } from "../src/state/store.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY");
if (!supabaseUrl || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  Deno.exit(1);
}

const kv = await Deno.openKv(Deno.args[0] ?? Deno.env.get("DENO_KV_PATH") ?? undefined);

const BATCH = 100;
let batch: Array<{ k: string; v: unknown }> = [];
let total = 0;

async function flush(): Promise<void> {
  if (batch.length === 0) return;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/kv_set_many`, {
    method: "POST",
    headers: {
      "apikey": serviceKey!,
      "Authorization": `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rows: batch }),
  });
  if (!res.ok) {
    console.error(`batch failed: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  total += batch.length;
  batch = [];
}

for await (const entry of kv.list({ prefix: [] })) {
  const key = entry.key.map((part) => {
    if (typeof part !== "string") {
      console.error(`non-string key segment in ${JSON.stringify(entry.key)} — skipping`);
      return null;
    }
    return part;
  });
  if (key.some((p) => p === null)) continue;
  batch.push({ k: encodeKey(key as string[]), v: entry.value });
  if (batch.length >= BATCH) await flush();
}
await flush();
kv.close();
console.log(`Migrated ${total} entries to Supabase.`);
