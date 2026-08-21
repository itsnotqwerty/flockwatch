import { assert, assertEquals } from "$assert";
import type { Cell, Encounter, Player } from "../types.ts";
import {
  applyCellMove,
  rewardCellParticipant,
  startCellEncounter,
} from "./cell-encounters.ts";

function player(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 10,
    region: "new_york_city",
    location: "midtown_rooftop_relay",
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

const cell: Cell = {
  id: "cell",
  name: "Bird Counters",
  leaderId: "p1",
  memberIds: ["p1", "p2"],
  createdAt: "",
};

const boss: Encounter = {
  id: "boss",
  name: "Director",
  art: "boomer",
  kind: "boss",
  regions: ["new_york_city"],
  minFlockPresence: 0,
  maxHp: 20,
  moves: [{
    id: "hit",
    label: "File evidence",
    damage: 10,
    selfDamage: 1,
    suspicion: 2,
  }],
  victoryLine: "Filed.",
  defeatLine: "Denied.",
  payout: 50,
  drops: ["binoculars"],
  materialDrops: { signal_crystal: 1 },
  clearsSuspicion: 5,
  phases: [{ at: 0.5, line: "The hearing recesses." }],
};

Deno.test("cell bosses require two colocated members and share enemy state", () => {
  assertEquals(startCellEncounter(boss, cell, [player("p1")]), null);
  const state = startCellEncounter(
    boss,
    cell,
    [player("p1"), player("p2")],
    0,
  )!;
  const first = applyCellMove(boss, state, player("p1"), "hit", 1)!;
  assertEquals(first.state.enemyHp, 10);
  assert(first.state.log.some((line) => line.includes("hearing recesses")));
  const second = applyCellMove(boss, first.state, player("p2"), "hit", 2)!;
  assert(second.victory);
  assertEquals(second.state.status, "victory");
  assert(second.state.log.some((line) => line.includes("1 signal crystal")));
});

Deno.test("cell boss rewards apply to every participant", () => {
  const rewarded = rewardCellParticipant(player("p1"), boss);
  assertEquals(rewarded.currency, 75);
  assertEquals(rewarded.inventory, ["binoculars"]);
  assertEquals(rewarded.scrap.signal_crystal, 1);
  assertEquals(rewarded.suspicion, 5);
});

Deno.test("a cell relay strengthens cooperative attacks", () => {
  const operator = player("p1", { inventory: ["cell_relay"] });
  const state = startCellEncounter(boss, cell, [operator, player("p2")], 0)!;
  const turn = applyCellMove(boss, state, operator, "hit", 1)!;
  assertEquals(turn.state.enemyHp, 7); // 10 base + 3 from the relay
});
