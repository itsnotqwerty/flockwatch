import { assert, assertEquals } from "$assert";
import { encodeKey, encodePrefix } from "./store.ts";

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
