import { assert, assertAlmostEquals, assertEquals } from "$assert";
import { ESPIONAGE_SUSPICION_CAP, isRestricted, marketFeeRate, performEspionage } from "./espionage.ts";
import type { Player, Region } from "../types.ts";

const region = (over: Partial<Region["stats"]> = {}): Region => ({
  id: "rust_belt",
  name: "The Rust Belt",
  locations: [],
  stats: {
    coverage: 0.5, unrest: 0.3, prosperity: 0.4, flockPresence: 0.5,
    populationMood: "wary", ...over,
  },
  economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
});

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1", name: "Citizen", currency: 50, inventory: [], scrap: {},
    suspicion: 0, region: "rust_belt", quests: [], flags: [], intel: {},
    restricted: [], ...over,
  };
}

Deno.test("successful espionage grants intel and slight suspicion", () => {
  const out = performEspionage("gather_intel", player(), region(), 0.0); // roll 0 = success
  assert(out.ok && out.success);
  assertEquals(out.intel, 2);
  assertEquals(out.player.intel.rust_belt, 2);
  assertEquals(out.player.flags.length, 0);
});

Deno.test("intercepts pay out currency on success", () => {
  const out = performEspionage("intercept", player(), region(), 0.0);
  assert(out.success);
  assertEquals(out.payout, 15);
  assertEquals(out.player.currency, 65);
});

Deno.test("blown operations flag the player and raise suspicion", () => {
  const out = performEspionage("tail", player({ suspicion: 40 }), region(), 0.999);
  assert(out.ok && !out.success);
  assert(out.flag);
  assertEquals(out.player.flags.length, 1);
  assertEquals(out.player.suspicion, 55);
});

Deno.test("a second flag in the same region restricts the player", () => {
  const once = performEspionage("tail", player(), region(), 0.999);
  assert(!once.success);
  const twice = performEspionage("tail", once.player, region(), 0.999);
  assert(!twice.success);
  assert(twice.player.restricted.includes("rust_belt"));
  assert(isRestricted(twice.player, "rust_belt"));
  // Restricted players cannot attempt further operations there.
  const blocked = performEspionage("tail", twice.player, region(), 0.0);
  assert(!blocked.ok);
});

Deno.test("espionage is refused above the suspicion cap", () => {
  const out = performEspionage("tail", player({ suspicion: ESPIONAGE_SUSPICION_CAP }), region(), 0.0);
  assert(!out.ok);
  assertEquals(out.player.suspicion, ESPIONAGE_SUSPICION_CAP);
});

Deno.test("market fee rate scales with flags", () => {
  assertEquals(marketFeeRate(player()), 0);
  const flagged = performEspionage("tail", player(), region(), 0.999).player;
  assertAlmostEquals(marketFeeRate(flagged), 0.15);
});
