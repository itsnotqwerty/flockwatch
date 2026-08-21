import { assert, assertEquals } from "$assert";
import {
  applyMove,
  eligibleEncounters,
  restAtHotel,
  rollEncounter,
  startEncounter,
} from "./encounters.ts";
import type { Encounter, Item, Player, Region } from "../types.ts";

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
  enemyMoves: [
    {
      id: "glare",
      label: "Glare menacingly",
      damage: 0,
      selfDamage: 0,
      suspicion: 3,
    },
    {
      id: "swat",
      label: "Swat at you",
      damage: 4,
      selfDamage: 0,
      suspicion: 0,
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
  const passive: Encounter = { ...patrol, enemyMoves: [] };
  const p = player({ suspicion: 20 });
  const state = startEncounter(passive, p);
  const t1 = applyMove(passive, state, p, "hit")!;
  assertEquals(t1.state.enemyHp, 10);
  assertEquals(t1.player.suspicion, 22);
  const t2 = applyMove(passive, t1.state, t1.player, "hit")!;
  assertEquals(t2.state.status, "victory");
  assertEquals(t2.player.currency, 110);
  assert(t2.player.inventory.includes("cutters"));
  assertEquals(t2.player.scrap.power_cell, 1);
  assert(t2.state.log.some((line) => line.includes("1 power cell")));
  assertEquals(t2.player.suspicion, 19); // 24 - 5 cleared
});

Deno.test("crafted combat gear raises damage and masks suspicion", () => {
  const passive: Encounter = { ...patrol, enemyMoves: [] };
  const p = player({ inventory: ["shock_baton", "covert_vest"] });
  const turn = applyMove(passive, startEncounter(passive, p), p, "hit")!;
  assertEquals(turn.state.enemyHp, 5); // 10 base + 5 from the baton
  assertEquals(turn.player.suspicion, 0); // vest absorbs the move's +2
});

Deno.test("fleeing ends the encounter in 'fled'", () => {
  const p = player();
  const turn = applyMove(patrol, startEncounter(patrol, p), p, "flee")!;
  assertEquals(turn.state.status, "fled");
});

Deno.test("boss phases announce as hp crosses thresholds", () => {
  const passiveBoss: Encounter = { ...boss, enemyMoves: [] };
  const p = player();
  let state = startEncounter(passiveBoss, p);
  let pl = p;
  // 100 → 40 crosses both 0.5 and 0.2? No: 6 hits of 10 = 40, crossing 0.5 only.
  const phaseLines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const t = applyMove(passiveBoss, state, pl, "hit")!;
    state = t.state;
    pl = t.player;
    if (t.phaseLine) phaseLines.push(t.phaseLine);
  }
  assertEquals(phaseLines, ["Phase two."]);
  assertEquals(state.enemyHp, 50);
  // Two more hits: 50 → 30 → still above 20; then one more crosses 0.2.
  for (let i = 0; i < 3; i++) {
    const t = applyMove(passiveBoss, state, pl, "hit")!;
    state = t.state;
    pl = t.player;
    if (t.phaseLine) phaseLines.push(t.phaseLine);
  }
  assertEquals(phaseLines, ["Phase two.", "Final phase."]);
  assertEquals(state.enemyHp, 20);
});

Deno.test("suspicion hitting the cap mid-fight is a defeat", () => {
  const passive: Encounter = { ...patrol, enemyMoves: [] };
  const p = player({ suspicion: 99 });
  const turn = applyMove(passive, startEncounter(passive, p), p, "hit")!;
  assertEquals(turn.state.status, "defeat");
});

Deno.test("random quips are picked on start and on ongoing turns", () => {
  const quippy: Encounter = {
    ...patrol,
    enemyMoves: [],
    quips: ["Quip A.", "Quip B.", "Quip C."],
  };
  const p = player();
  // roll 0.9 selects index 2 of 3.
  const state = startEncounter(quippy, p, 0.9);
  assertEquals(state.quip, "Quip C.");
  const turn = applyMove(quippy, state, p, "hit", 0.0)!;
  assertEquals(turn.state.quip, "Quip A.");
  // Quips live on the state for grillsay rendering, not in the log.
  assert(!turn.state.log.some((l) => l.includes("Quip A.")));
  // No quips on terminal turns.
  const kill = applyMove(quippy, turn.state, turn.player, "hit", 0.0)!;
  assertEquals(kill.state.status, "victory");
  assertEquals(kill.state.quip, "Quip A."); // previous quip unchanged
  // Encounters without quips never set one.
  const passive: Encounter = { ...patrol, enemyMoves: [] };
  const plain = applyMove(passive, startEncounter(passive, p), p, "hit", 0.5)!;
  assertEquals(plain.state.quip, undefined);
  assertEquals(plain.state.log.length, 2);
});

Deno.test("self-damage lowers persistent hp; defeat at 0", () => {
  const p = player({ hp: 8 });
  const rough: Encounter = {
    ...patrol,
    enemyMoves: [],
    moves: [
      { id: "hit", label: "Hit", damage: 5, selfDamage: 6, suspicion: 0 },
    ],
  };
  const t1 = applyMove(rough, startEncounter(rough, p), p, "hit")!;
  assertEquals(t1.player.hp, 2);
  assertEquals(t1.state.status, "ongoing");
  const t2 = applyMove(rough, t1.state, t1.player, "hit")!;
  assertEquals(t2.player.hp, 0);
  assertEquals(t2.state.status, "defeat");
});

Deno.test("surviving enemies counter-attack with a random move", () => {
  const p = player({ hp: 40 });
  // enemyRoll 1.0 selects the last move (swat: 4 damage).
  const t1 = applyMove(patrol, startEncounter(patrol, p), p, "hit", 0.5, 1.0)!;
  assertEquals(t1.player.hp, 36);
  assert(
    t1.state.log.some((l) => l.includes("Test Patrol answers: Swat at you.")),
  );
  // enemyRoll 0.0 selects glare: no damage, +3 suspicion.
  const t2 = applyMove(patrol, t1.state, t1.player, "hit", 0.5, 0.0)!;
  assertEquals(t2.state.status, "victory"); // 10+10 hp damage kills 20hp patrol
  assertEquals(t2.player.hp, 36); // dead enemies don't counter
});

Deno.test("enemy counters can finish the player", () => {
  const p = player({ hp: 4 });
  const t = applyMove(patrol, startEncounter(patrol, p), p, "hit", 0.5, 1.0)!;
  assertEquals(t.player.hp, 0);
  assertEquals(t.state.status, "defeat");
});

const tradeable: Item = {
  id: "cutters",
  name: "Cutters",
  description: "",
  rarity: "common",
  tradeable: true,
};
const permanent: Item = { ...tradeable, id: "press_badge", tradeable: false };

Deno.test("a wipe strips intel, suspicion, credits, scrap, and tradeable items", () => {
  const p = player({
    hp: 4,
    currency: 250,
    suspicion: 42,
    intel: { cleveland: 3, seattle: 1 },
    scrap: { lens: 2, wiring: 1 },
    inventory: ["cutters", "press_badge"],
  });
  const t = applyMove(
    patrol,
    startEncounter(patrol, p),
    p,
    "hit",
    0.5,
    1.0,
    [tradeable, permanent],
  )!;
  assertEquals(t.state.status, "defeat");
  assertEquals(t.player.hp, 0);
  assertEquals(t.player.currency, 0);
  assertEquals(t.player.suspicion, 0);
  assertEquals(t.player.intel, {});
  assertEquals(t.player.scrap, {});
  // Tradeable gear is gone; the permanent badge stays.
  assertEquals(t.player.inventory, ["press_badge"]);
});

Deno.test("attrition defeats wipe the player too", () => {
  const p = player({ hp: 6, currency: 90, intel: { cleveland: 2 } });
  const rough: Encounter = {
    ...patrol,
    enemyMoves: [],
    moves: [
      { id: "hit", label: "Hit", damage: 5, selfDamage: 6, suspicion: 0 },
    ],
  };
  const t = applyMove(rough, startEncounter(rough, p), p, "hit")!;
  assertEquals(t.state.status, "defeat");
  assertEquals(t.player.currency, 0);
  assertEquals(t.player.intel, {});
});

Deno.test("suspicion-cap defeats are not wipes", () => {
  const p = player({ hp: 40, suspicion: 99, currency: 50 });
  const t = applyMove(patrol, startEncounter(patrol, p), p, "hit", 0.5, 1.0)!;
  assertEquals(t.state.status, "defeat");
  assertEquals(t.player.currency, 50);
  assert(t.player.suspicion >= 100);
});

Deno.test("hotel rest costs 30cr and restores hp to full", () => {
  const tired = player({ hp: 12, currency: 50 });
  const rested = restAtHotel(tired)!;
  assertEquals(rested.hp, 40);
  assertEquals(rested.currency, 20);
  // Refused when broke or already rested.
  assertEquals(restAtHotel(player({ hp: 12, currency: 29 })), null);
  assertEquals(restAtHotel(player({ hp: 40 })), null);
  // Legacy saves without hp count as full.
  assertEquals(restAtHotel(player({ currency: 100 })), null);
});
