import { assertEquals } from "$assert";
import { activeDecrees, decreeMultiplier, decreedPrice, makeDecree } from "./decrees.ts";
import type { Decree } from "../types.ts";

const NOW = Date.parse("2026-08-19T12:00:00Z");

function decree(over: Partial<Decree> = {}): Decree {
  return {
    id: "d1",
    title: "Test Decree",
    proclamation: "By order.",
    priceMultiplier: 1.2,
    scope: "national",
    region: null,
    issuedAt: "2026-08-01T00:00:00Z",
    expiresAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

Deno.test("activeDecrees filters by expiry and scope", () => {
  const all = [
    decree({ id: "nat" }),
    decree({ id: "reg_hit", scope: "regional", region: "rust_belt" }),
    decree({ id: "reg_miss", scope: "regional", region: "florida" }),
    decree({ id: "expired", expiresAt: "2026-08-01T00:00:00Z" }),
  ];
  const active = activeDecrees(all, "rust_belt", NOW).map((d) => d.id);
  assertEquals(active.sort(), ["nat", "reg_hit"]);
});

Deno.test("multipliers stack multiplicatively", () => {
  const all = [
    decree({ id: "a", priceMultiplier: 1.2 }),
    decree({ id: "b", scope: "regional", region: "rust_belt", priceMultiplier: 1.1 }),
  ];
  assertEquals(decreeMultiplier(all, "rust_belt", NOW), 1.2 * 1.1);
  assertEquals(decreeMultiplier(all, "florida", NOW), 1.2);
  assertEquals(decreeMultiplier([], "rust_belt", NOW), 1);
});

Deno.test("decreedPrice rounds and floors at 1", () => {
  assertEquals(decreedPrice(50, [decree()], "rust_belt", NOW), 60);
  assertEquals(decreedPrice(0.4, [], "rust_belt", NOW), 1);
});

Deno.test("makeDecree stamps issue and expiry", () => {
  const d = makeDecree("x", "T", "P", 1.5, "regional", "florida", NOW, 60_000);
  assertEquals(d.issuedAt, new Date(NOW).toISOString());
  assertEquals(d.expiresAt, new Date(NOW + 60_000).toISOString());
});
