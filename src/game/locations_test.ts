import { assert, assertEquals } from "$assert";
import type { LocationInteraction, Player, Sublocation } from "../types.ts";
import { performLocationAction, travelWithinRegion } from "./locations.ts";

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 10,
    inventory: [],
    scrap: {},
    suspicion: 5,
    region: "cleveland",
    location: "mill",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
    ...overrides,
  };
}

const mill: Sublocation = {
  id: "mill",
  regionId: "cleveland",
  name: "Mill",
  description: "Cold.",
  interactions: [],
};

const salvage: LocationInteraction = {
  id: "salvage",
  label: "Salvage",
  description: "Recover parts.",
  kind: "activity",
  result: "Parts recovered.",
  effect: {
    currency: -3,
    suspicion: 2,
    intel: 1,
    scrap: { wiring: 2 },
    item: "binoculars",
  },
  once: true,
};

Deno.test("travelWithinRegion moves only within the current city", () => {
  const destination = { ...mill, id: "arcade" };
  const moved = travelWithinRegion(player(), destination);
  assert(moved.ok);
  assertEquals(moved.player.location, "arcade");
  const refused = travelWithinRegion(player(), {
    ...destination,
    regionId: "atlanta",
  });
  assert(!refused.ok);
  assertEquals(refused.player.location, "mill");
});

Deno.test("location activities apply effects atomically and only once", () => {
  const first = performLocationAction(player(), mill, salvage);
  assert(first.ok);
  assertEquals(first.player.currency, 7);
  assertEquals(first.player.suspicion, 7);
  assertEquals(first.player.intel.cleveland, 1);
  assertEquals(first.player.scrap.wiring, 2);
  assertEquals(first.player.inventory, ["binoculars"]);
  const second = performLocationAction(first.player, mill, salvage);
  assert(!second.ok);
  assertEquals(second.player.scrap.wiring, 2);
});

Deno.test("location activities reject unaffordable costs", () => {
  const result = performLocationAction(player({ currency: 1 }), mill, salvage);
  assert(!result.ok);
  assertEquals(result.player.currency, 1);
  assertEquals(result.player.completedLocationActions, []);
});
