import { assertEquals } from "$assert";
import type { MessagePost } from "../types.ts";
import { createMemoryStore } from "./store.ts";
import {
  listMessagePosts,
  MAX_MESSAGE_LENGTH,
  normalizeMessageBody,
  saveMessagePost,
} from "./message-board.ts";

Deno.test("message bodies are short, non-empty, and whitespace-normalized", () => {
  assertEquals(normalizeMessageBody("  the   birds\nknow  "), "the birds know");
  assertEquals(normalizeMessageBody("   \n "), null);
  assertEquals(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1)), null);
});

Deno.test("message boards are isolated by region and newest-first", async () => {
  const store = createMemoryStore();
  const post = (
    id: string,
    regionId: string,
    postedAt: string,
  ): MessagePost => ({
    id,
    regionId,
    playerId: "p1",
    author: "Citizen",
    body: id,
    postedAt,
  });
  await saveMessagePost(
    post("old", "cleveland", "2026-01-01T00:00:00Z"),
    store,
  );
  await saveMessagePost(
    post("new", "cleveland", "2026-01-02T00:00:00Z"),
    store,
  );
  await saveMessagePost(
    post("elsewhere", "atlanta", "2026-01-03T00:00:00Z"),
    store,
  );
  assertEquals(
    (await listMessagePosts("cleveland", 10, store)).map((entry) => entry.id),
    ["new", "old"],
  );
  assertEquals(
    (await listMessagePosts("atlanta", 10, store)).map((entry) => entry.id),
    ["elsewhere"],
  );
});
