import { assertEquals } from "$assert";
import { createMemoryStore } from "./store.ts";
import {
  moderateMessagePost,
  POST_COOLDOWN_MS,
  screenMessageContent,
} from "./message-moderation.ts";

Deno.test("mild profanity and ordinary game talk are allowed", () => {
  assertEquals(screenMessageContent("Damn, these cameras are bullshit."), {
    allowed: true,
  });
  assertEquals(screenMessageContent("That boss is killing me."), {
    allowed: true,
  });
});

Deno.test("slurs and direct threats are rejected", () => {
  assertEquals(screenMessageContent("you are a n1gger").allowed, false);
  assertEquals(screenMessageContent("I am going to shoot you").allowed, false);
  assertEquals(screenMessageContent("You should die").allowed, false);
});

Deno.test("obvious content spam is rejected", () => {
  assertEquals(
    screenMessageContent("https://a.test https://b.test https://c.test")
      .allowed,
    false,
  );
  assertEquals(screenMessageContent("loooooooooooooooooool").allowed, false);
  assertEquals(screenMessageContent("buy buy buy buy buy").allowed, false);
});

Deno.test("posting cooldown and duplicate detection are per player", async () => {
  const store = createMemoryStore();
  const now = Date.parse("2026-08-20T12:00:00Z");
  assertEquals(
    await moderateMessagePost("p1", "Meet at the archive.", now, store),
    { allowed: true },
  );
  assertEquals(
    (await moderateMessagePost("p1", "A second post.", now + 1_000, store))
      .allowed,
    false,
  );
  assertEquals(
    await moderateMessagePost(
      "p2",
      "A second post.",
      now + 1_000,
      store,
    ),
    { allowed: true },
  );
  assertEquals(
    await moderateMessagePost(
      "p1",
      "Meet at the archive.",
      now + POST_COOLDOWN_MS + 1_000,
      store,
    ),
    {
      allowed: false,
      reason: "spam",
      message: "Duplicate notices are not permitted.",
    },
  );
});

Deno.test("rolling submission cap includes rejected attempts", async () => {
  const store = createMemoryStore();
  const now = Date.parse("2026-08-20T12:00:00Z");
  for (let attempt = 0; attempt < 5; attempt++) {
    await moderateMessagePost(
      "p1",
      `Notice number ${attempt}`,
      now + attempt * 10_000,
      store,
    );
  }
  assertEquals(
    await moderateMessagePost("p1", "One notice too many", now + 50_000, store),
    {
      allowed: false,
      reason: "spam",
      message: "Too many notices were submitted. Try again in a minute.",
    },
  );
});
