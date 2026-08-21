import { assert, assertEquals } from "$assert";
import type { Cell, Player } from "../types.ts";
import {
  advanceCellOperation,
  rewardCellOperation,
  startCellOperation,
} from "./cell-operations.ts";

function player(id: string, over: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "cleveland_memorial_park",
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
  id: "cell_1",
  name: "Lamp Auditors",
  leaderId: "a",
  memberIds: ["a", "b"],
  createdAt: "",
};

Deno.test("cell operation requires two colocated members", () => {
  assertEquals(startCellOperation(cell, [player("a")]), null);
  assert(startCellOperation(cell, [player("a"), player("b")]) !== null);
});

Deno.test("cell operation advances in order with distinct participants", () => {
  const state = startCellOperation(cell, [player("a"), player("b")], 0)!;
  const first = advanceCellOperation(state, player("a"), "tail", 1)!;
  assertEquals(first.state.stageIndex, 1);
  assertEquals(first.actor.suspicion, 4);
  assertEquals(
    advanceCellOperation(first.state, player("a"), "intercept")!.reason,
    "Another cell member must take the next stage.",
  );
  const second = advanceCellOperation(
    first.state,
    player("b"),
    "intercept",
    2,
  )!;
  const third = advanceCellOperation(
    second.state,
    player("a"),
    "gather_intel",
    3,
  )!;
  assert(third.completed);
  assertEquals(third.state.status, "completed");
  const rewarded = rewardCellOperation(player("a"), "cleveland");
  assertEquals(rewarded.currency, 45);
  assertEquals(rewarded.intel.cleveland, 3);
  assertEquals(rewarded.scrap.signal_crystal, 1);
});

Deno.test("cell relay reduces coordinated-operation suspicion", () => {
  const relayUser = player("a", { inventory: ["cell_relay"] });
  const state = startCellOperation(cell, [relayUser, player("b")], 0)!;
  const turn = advanceCellOperation(state, relayUser, "tail", 1)!;
  assertEquals(turn.actor.suspicion, 2);
});
