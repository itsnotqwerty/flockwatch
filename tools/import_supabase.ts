import postgres from "postgres";

const sourceUrl = Deno.env.get("SOURCE_DATABASE_URL");
const destinationUrl = Deno.env.get("DATABASE_URL");
if (!sourceUrl || !destinationUrl || sourceUrl === destinationUrl) {
  throw new Error("Set distinct SOURCE_DATABASE_URL and DATABASE_URL values.");
}
const source = postgres(sourceUrl, { max: 1 });
const destination = postgres(destinationUrl, { max: 1 });
try {
  await source.begin(async (read) => {
    await read`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await destination.begin(async (write) => {
      await write`LOCK TABLE kv_store IN EXCLUSIVE MODE`;
      const [existing] = await write`SELECT key FROM kv_store LIMIT 1`;
      if (existing) {
        throw new Error("Destination must be empty; no data was imported.");
      }
      for await (
        const rows of read`SELECT key, value, expires_at FROM kv_store
        WHERE expires_at IS NULL OR expires_at > now()`.cursor(100)
      ) {
        for (const row of rows) {
          const key = JSON.parse(row.key);
          if (
            !Array.isArray(key) ||
            !key.every((part) => typeof part === "string")
          ) throw new Error("Invalid source key.");
          if (key[0] === "sessions" || key[0]?.startsWith("auth_")) continue;
          await write`INSERT INTO kv_store (key, value, expires_at)
            VALUES (${row.key}, ${write.json(row.value)}, ${row.expires_at})`;
        }
      }
      for await (
        const users
          of read`SELECT id, email, encrypted_password, email_confirmed_at FROM auth.users
        WHERE email IS NOT NULL`.cursor(100)
      ) {
        for (const user of users) {
          if (
            user.encrypted_password &&
            !/^\$2[aby]\$/.test(user.encrypted_password)
          ) {
            throw new Error(
              "Unsupported password hash. Resolve credential migration before cutover.",
            );
          }
          const credential = {
            id: user.id,
            email: user.email.trim().toLowerCase(),
            passwordHash: user.encrypted_password || "",
            version: crypto.randomUUID(),
            confirmed: Boolean(user.email_confirmed_at),
          };
          await write`INSERT INTO kv_store (key, value) VALUES
            (${JSON.stringify(["auth_credentials", credential.email])}, ${
            write.json(credential)
          })`;
        }
      }
    });
  });
  console.log("Imported game state and credentials. Users must sign in again.");
} finally {
  await source.end();
  await destination.end();
}
