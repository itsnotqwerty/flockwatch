import { assert, assertEquals } from "$assert";
import {
  applyMove,
  eligibleEncounters,
  rollEncounter,
  startEncounter,
} from "./encounters.ts";
import type { Encounter, Player, Region } from "../types.ts";

const patrol: Encounter = {
  id: "patrol_x",
  name: "Test Patrol",
  art: "glangley",
  kind: "patrol",
  regions: ["cleveland"],
  minFlockPresence: 0.4,
  maxHp: 20,
  moves: [
    { id: "hit", label: "Hit", damage: 10, selfDamage: 0, suspicion: 2 },
    {
      id: "flee",
      label: "Flee",
      damage: 0,
      selfDamage: 0,
      suspicion: 5,
      flees: true,
    },
  ],
  victoryLine: "You win.",
  defeatLine: "You lose.",
  payout: 10,
  drops: ["cutters"],
  materialDrops: { power_cell: 1 },
  clearsSuspicion: 5,
};

const boss: Encounter = {
  ...patrol,
  id: "boss_x",
  name: "Test Boss",
  kind: "boss",
  minFlockPresence: 0,
  maxHp: 100,
  phases: [
    { at: 0.5, line: "Phase two." },
    { at: 0.2, line: "Final phase." },
  ],
};

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 100,
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

const region = (flockPresence: number): Region => ({
  id: "cleveland",
  name: "Cleveland",
  locations: [],
  stats: {
    coverage: 0.5,
    unrest: 0.3,
    prosperity: 0.4,
    flockPresence,
    populationMood: "wary",
  },
  economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
});

Deno.test("patrols gate on Flock presence; bosses do not", () => {
  assertEquals(
    eligibleEncounters([patrol, boss], region(0.2), player()).map((e) => e.id),
    ["boss_x"],
  );
  assertEquals(
    eligibleEncounters([patrol, boss], region(0.6), player()).length,
    2,
  );
});

Deno.test("restricted players get no encounters", () => {
  const p = player({ restricted: ["cleveland"] });
  assertEquals(eligibleEncounters([patrol, boss], region(0.9), p), []);
});

Deno.test("rollEncounter returns null below the spawn chance", () => {
  assertEquals(rollEncounter([patrol], region(0.4), player(), 0.99), null);
  assert(rollEncounter([patrol], region(0.6), player(), 0.0) !== null);
});

Deno.test("moves damage the enemy; victory pays out and clears suspicion", () => {
  const p = player({ suspicion: 20 });
  const state = startEncounter(patrol, p);
  const t1 = applyMove(patrol, state, p, "hit")!;
  assertEquals(t1.state.enemyHp, 10);
  assertEquals(t1.player.suspicion, 22);
  const t2 = applyMove(patrol, t1.state, t1.player, "hit")!;
  assertEquals(t2.state.status, "victory");
  assertEquals(t2.player.currency, 110);
  assert(t2.player.inventory.includes("cutters"));
  assertEquals(t2.player.scrap.power_cell, 1);
  assert(t2.state.log.some((line) => line.includes("1 power cell")));
  assertEquals(t2.player.suspicion, 19); // 24 - 5 cleared
});

Deno.test("crafted combat gear raises damage and masks suspicion", () => {
  const p = player({ inventory: ["shock_baton", "covert_vest"] });
  const turn = applyMove(patrol, startEncounter(patrol, p), p, "hit")!;
  assertEquals(turn.state.enemyHp, 5); // 10 base + 5 from the baton
  assertEquals(turn.player.suspicion, 0); // vest absorbs the move's +2
});

Deno.test("fleeing ends the encounter in 'fled'", () => {
  const p = player();
  const turn = applyMove(patrol, startEncounter(patrol, p), p, "flee")!;
  assertEquals(turn.state.status, "fled");
});

Deno.test("boss phases announce as hp crosses thresholds", () => {
  const p = player();
  let state = startEncounter(boss, p);
  let pl = p;
  // 100 → 40 crosses both 0.5 and 0.2? No: 6 hits of 10 = 40, crossing 0.5 only.
  const phaseLines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = applyMove(boss, state, pl, "hit")!;
    state = t.state;
    pl = t.player;
    if (t.phaseLine) phaseLines.push(t.phaseLine);
  }
  assertEquals(phaseLines, ["Phase two."]);
  assertEquals(state.enemyHp, 50);
  // Two more hits: 50 → 30 → still above 20; then one more crosses 0.2.
  for (let i = 0; i < 3; i++) {
    const t = applyMove(boss, state, pl, "hit")!;
    state = t.state;
    pl = t.player;
    if (t.phaseLine) phaseLines.push(t.phaseLine);
  }
  assertEquals(phaseLines, ["Phase two.", "Final phase."]);
  assertEquals(state.enemyHp, 20);
});

Deno.test("suspicion hitting the cap mid-fight is a defeat", () => {
  const p = player({ suspicion: 99 });
  const turn = applyMove(patrol, startEncounter(patrol, p), p, "hit")!;
  assertEquals(turn.state.status, "defeat");
});
