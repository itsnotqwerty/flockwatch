import { assertEquals } from "$assert";
import { createMemoryStore } from "./store.ts";
import { claimActionRequest } from "./action-requests.ts";

Deno.test("action request ids can only be claimed once per player", async () => {
  const store = createMemoryStore();
  const requestId = "1475473d-75b9-455b-9f20-4337638d9750";
  assertEquals(await claimActionRequest("p1", requestId, store), true);
  assertEquals(await claimActionRequest("p1", requestId, store), false);
  assertEquals(await claimActionRequest("p2", requestId, store), true);
});

Deno.test("missing and malformed action ids are rejected", async () => {
  const store = createMemoryStore();
  assertEquals(await claimActionRequest("p1", undefined, store), false);
  assertEquals(
    await claimActionRequest("p1", "not-a-request-id", store),
    false,
  );
});
