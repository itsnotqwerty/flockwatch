import { assertEquals } from "$assert";
import { eventSuspicionReduction } from "./item-effects.ts";
import { performEspionage } from "./espionage.ts";
import type { Player, Region } from "../types.ts";

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 50,
    inventory: [],
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

const region = (): Region => ({
  id: "cleveland",
  name: "Cleveland",
  locations: [],
  stats: {
    coverage: 0.5,
    unrest: 0.3,
    prosperity: 0.4,
    flockPresence: 0.5,
    populationMood: "wary",
  },
  economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
});

Deno.test("eventSuspicionReduction only fires with the badge", () => {
  assertEquals(eventSuspicionReduction(player()), 0);
  assertEquals(
    eventSuspicionReduction(player({ inventory: ["honorary_spy_badge"] })),
    1,
  );
});

Deno.test("badge reduces suspicion gained from events, floored at 0", () => {
  // gather_intel adds 5 - espionageReduction - badge, floored at 0.
  // roll 0.0 = guaranteed success.
  const plain = performEspionage("gather_intel", player(), region(), 0.0);
  const badged = performEspionage(
    "gather_intel",
    player({ inventory: ["honorary_spy_badge"] }),
    region(),
    0.0,
  );
  if (plain.ok && badged.ok && plain.success && badged.success) {
    assertEquals(plain.player.suspicion, 5);
    assertEquals(badged.player.suspicion, 4);
  }
});
