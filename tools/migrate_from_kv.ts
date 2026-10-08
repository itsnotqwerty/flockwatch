import postgres from "postgres";

const url = Deno.env.get("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is required.");
const sql = postgres(url, { max: 1 });
const kv = await Deno.openKv(
  Deno.args[0] ?? Deno.env.get("DENO_KV_PATH") ?? undefined,
);
try {
  await sql.begin(async (transaction) => {
    await transaction`LOCK TABLE kv_store IN EXCLUSIVE MODE`;
    const [existing] = await transaction`SELECT key FROM kv_store LIMIT 1`;
    if (existing) throw new Error("Destination must be empty.");
    for await (const entry of kv.list({ prefix: [] })) {
      if (!entry.key.every((part) => typeof part === "string")) {
        throw new Error("Non-string key in source KV.");
      }
      const collection = String(entry.key[0]);
      if (
        collection === "sessions" || collection === "auth_tokens" ||
        collection === "action_requests" ||
        collection.includes("lock")
      ) continue;
      await transaction`INSERT INTO kv_store (key, value)
        VALUES (${JSON.stringify(entry.key)}, ${
        transaction.json(entry.value as postgres.JSONValue)
      })`;
    }
  });
  console.log(
    "Imported KV entries. Sessions and temporary claims were excluded.",
  );
} finally {
  kv.close();
  await sql.end();
}
