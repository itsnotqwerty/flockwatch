import { assert, assertEquals } from "$assert";
import { BASE_TRAVEL_COST, travel, travelCost } from "./travel.ts";
import type { Player, Region } from "../types.ts";

function region(id: string, flockPresence: number): Region {
  return {
    id,
    name: id,
    locations: [],
    stats: { coverage: 0, unrest: 0, prosperity: 0, flockPresence, populationMood: "wary" },
    economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
  };
}

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 100,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
    ...over,
  };
}

Deno.test("travelCost scales with destination Flock presence", () => {
  assert(travelCost(region("x", 0.9)) > travelCost(region("x", 0.1)));
  assertEquals(travelCost(region("x", 0)), Math.round(BASE_TRAVEL_COST * 0.5));
});

Deno.test("travel moves the player and charges the cost", () => {
  const dest = region("gulf_coast", 0.85);
  const result = travel(player(), dest);
  assert(result.ok);
  assertEquals(result.player.region, "gulf_coast");
  assertEquals(result.player.currency, 100 - travelCost(dest));
});

Deno.test("travel rejects staying put and insufficient funds", () => {
  const same = travel(player(), region("rust_belt", 0.7));
  assert(!same.ok);
  assertEquals(same.reason, "You are already there.");
  const broke = travel(player({ currency: 0 }), region("gulf_coast", 0.85));
  assert(!broke.ok);
  assert(broke.reason?.includes("credits"));
});

Deno.test("Bureaucrat's Stamp halves travel cost", () => {
  const dest = region("gulf_coast", 0.85);
  const stamped = player({ inventory: ["bureaucrats_stamp"] });
  assertEquals(travelCost(dest, stamped), Math.round(travelCost(dest) / 2));
  const result = travel(stamped, dest);
  assert(result.ok);
  assertEquals(result.player.currency, 100 - travelCost(dest, stamped));
});
