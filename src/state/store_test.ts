import { assert, assertEquals } from "$assert";
import {
  createMemoryStore,
  createPostgresStore,
  encodeKey,
  encodePrefix,
} from "./store.ts";

Deno.test("encodeKey round-trips through JSON", () => {
  const key = ["market", "cleveland", "listing_1"];
  assertEquals(JSON.parse(encodeKey(key)), key);
});

Deno.test("encodePrefix matches children of the prefix", () => {
  const prefix = encodePrefix(["npcs"]);
  assert(prefix.startsWith("["));
  assertEquals(encodeKey(["npcs", "bob"]).startsWith(prefix), true);
  // Sibling top-level collections must not match.
  assertEquals(encodeKey(["quests", "q1"]).startsWith(prefix), false);
  // A key equal to the prefix itself has no children encoding.
  assertEquals(encodeKey(["npcs"]).startsWith(prefix), false);
});

Deno.test("encodePrefix of empty prefix matches everything", () => {
  assertEquals(encodePrefix([]), "[");
});

Deno.test("memory keys preserve segment boundaries", async () => {
  const store = createMemoryStore();
  await store.set(["ab", "c"], 1);
  await store.set(["a", "bc"], 2);
  assertEquals(await store.get(["ab", "c"]), 1);
  assertEquals(await store.get(["a", "bc"]), 2);
  assertEquals(await store.list<number>(["ab"]), [{
    key: ["ab", "c"],
    value: 1,
  }]);
});

Deno.test("memory setIfAbsent honors expiry", async () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const store = createMemoryStore();
    assert(await store.setIfAbsent(["lock"], true, 50));
    assertEquals(await store.setIfAbsent(["lock"], true, 50), false);
    now = 1_051;
    assert(await store.setIfAbsent(["lock"], true, 50));
  } finally {
    Date.now = originalNow;
  }
});

Deno.test({
  name:
    "Postgres store preserves keys, TTLs, atomic claims and token consumption",
  ignore: !Deno.env.get("TEST_DATABASE_URL"),
  async fn() {
    const store = createPostgresStore(Deno.env.get("TEST_DATABASE_URL")!);
    const prefix = ["store_test", crypto.randomUUID(), "%_\\"];
    try {
      await store.set(prefix, { root: true });
      await store.set([...prefix, "child"], { child: true });
      assertEquals((await store.list(prefix)).length, 2);
      assertEquals(await store.get(prefix), { root: true });
      const claims = await Promise.all(
        Array.from(
          { length: 10 },
          () => store.setIfAbsent([...prefix, "lock"], true),
        ),
      );
      assertEquals(claims.filter(Boolean).length, 1);
      const tokens = await Promise.all(
        Array.from({ length: 10 }, () => store.take([...prefix, "lock"])),
      );
      assertEquals(tokens.filter(Boolean).length, 1);
      await store.setIfAbsent([...prefix, "expired"], true, -1);
      assertEquals(await store.get([...prefix, "expired"]), null);
      assertEquals(await store.take([...prefix, "expired"]), null);
      assert(await store.setIfAbsent([...prefix, "expired"], false));
      assertEquals(await store.take([...prefix, "expired"]), false);
    } finally {
      for (const suffix of [[], ["child"], ["lock"], ["expired"]]) {
        await store.delete([...prefix, ...suffix]);
      }
      await store.close();
    }
  },
});
