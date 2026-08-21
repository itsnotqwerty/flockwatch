import { assert, assertEquals } from "$assert";
import { BASE_TRAVEL_COST, travel, travelCost } from "./travel.ts";
import type { Player, Region } from "../types.ts";

function region(id: string, flockPresence: number): Region {
  return {
    id,
    name: id,
    locations: [`${id}_center`],
    stats: {
      coverage: 0,
      unrest: 0,
      prosperity: 0,
      flockPresence,
      populationMood: "wary",
    },
    economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
  };
}

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 100,
    inventory: ["temporary_flock_credential"],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "cuyahoga_rolling_mill",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
    ...over,
  };
}

Deno.test("travelCost scales with destination Flock presence", () => {
  assert(travelCost(region("x", 0.9)) > travelCost(region("x", 0.1)));
  assertEquals(travelCost(region("x", 0)), Math.round(BASE_TRAVEL_COST * 0.5));
});

Deno.test("travel moves the player and charges the cost", () => {
  const dest = region("new_orleans", 0.85);
  const traveler = player();
  const result = travel(traveler, dest);
  assert(result.ok);
  assertEquals(result.player.region, "new_orleans");
  assertEquals(result.player.location, "new_orleans_center");
  assertEquals(result.player.currency, 100 - travelCost(dest, traveler));
});

Deno.test("contractor credential authorizes travel without discounting it", () => {
  const dest = region("new_orleans", 0.85);
  assertEquals(travelCost(dest, player()), travelCost(dest));
});

Deno.test("travel is locked until the contractor credential is earned", () => {
  const result = travel(
    player({ inventory: [] }),
    region("new_orleans", 0.85),
  );
  assert(!result.ok);
  assert(result.reason?.includes("temporary Flock contractor credential"));
  assertEquals(result.player.region, "cleveland");
});

Deno.test("legacy players outside Cleveland receive a free one-way return", () => {
  const legacy = player({
    inventory: [],
    currency: 0,
    region: "boston",
    location: "bos_harbor_archive",
  });
  const returned = travel(legacy, region("cleveland", 0.7));
  assert(returned.ok);
  assertEquals(returned.player.region, "cleveland");
  assertEquals(returned.player.location, "cleveland_center");
  assertEquals(returned.player.currency, 0);

  const stillLocked = travel(legacy, region("new_york_city", 0.9));
  assert(!stillLocked.ok);
  assertEquals(stillLocked.player.region, "boston");
});

Deno.test("travel rejects staying put and insufficient funds", () => {
  const same = travel(player(), region("cleveland", 0.7));
  assert(!same.ok);
  assertEquals(same.reason, "You are already there.");
  const broke = travel(player({ currency: 0 }), region("new_orleans", 0.85));
  assert(!broke.ok);
  assert(broke.reason?.includes("credits"));
});

Deno.test("Bureaucrat's Stamp halves travel cost", () => {
  const dest = region("new_orleans", 0.85);
  const stamped = player({
    inventory: ["temporary_flock_credential", "bureaucrats_stamp"],
  });
  assertEquals(travelCost(dest, stamped), Math.round(travelCost(dest) / 2));
  const result = travel(stamped, dest);
  assert(result.ok);
  assertEquals(result.player.currency, 100 - travelCost(dest, stamped));
});

Deno.test("transit transponder discounts travel and stacks with the stamp", () => {
  const dest = region("new_orleans", 0.85);
  const transponder = player({
    inventory: ["temporary_flock_credential", "transit_transponder"],
  });
  assertEquals(
    travelCost(dest, transponder),
    Math.round(travelCost(dest) * 0.75),
  );
  const stacked = player({
    inventory: [
      "temporary_flock_credential",
      "bureaucrats_stamp",
      "transit_transponder",
    ],
  });
  assertEquals(
    travelCost(dest, stacked),
    Math.round(travelCost(dest) * 0.5 * 0.75),
  );
});
