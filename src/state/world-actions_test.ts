import { assert, assertEquals } from "$assert";
import { createMemoryStore } from "./store.ts";
import { claimWorldAction, releaseWorldAction } from "./world-actions.ts";

Deno.test("shared world actions are serialized and can be released", async () => {
  const store = createMemoryStore();
  assert(await claimWorldAction("market_buy", "listing", store));
  assertEquals(await claimWorldAction("market_buy", "listing", store), false);
  assert(await claimWorldAction("camera_install", "listing", store));
  await releaseWorldAction("market_buy", "listing", store);
  assert(await claimWorldAction("market_buy", "listing", store));
});
