import { assert, assertEquals } from "$assert";
import { createMemoryStore, encodeKey, encodePrefix } from "./store.ts";

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
