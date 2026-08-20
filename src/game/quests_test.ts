import { assert, assertEquals } from "$assert";
import { advanceStage, objectiveText, visibleQuests } from "./quests.ts";
import { quests } from "./fixtures.ts";
import type { Player } from "../types.ts";

function playerWith(
  questId: string,
  status: "accepted" | "completed" | "failed",
): Player {
  return {
    id: "test",
    name: "Tester",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "cuyahoga_rolling_mill",
    quests: [{ questId, status, stageIndex: 0 }],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
  };
}

Deno.test("undiscovered quests never appear in the log", () => {
  const player = playerWith("q_pigeon_audit", "accepted");
  const log = visibleQuests(player, quests);
  assertEquals(log.length, 1);
  assertEquals(log[0].quest.id, "q_pigeon_audit");
  // The other two defined quests exist in content but are undiscovered.
  assert(!log.some((e) => e.quest.id === "q_form_27b"));
  assert(!log.some((e) => e.quest.id === "q_flock_orientation"));
});

Deno.test("objectiveText returns stage objective for active quests", () => {
  const [entry] = visibleQuests(
    playerWith("q_pigeon_audit", "accepted"),
    quests,
  );
  assertEquals(objectiveText(entry), "Count the pigeons. All of them.");
});

Deno.test("objectiveText reports completed/failed status", () => {
  const [done] = visibleQuests(
    playerWith("q_pigeon_audit", "completed"),
    quests,
  );
  assert(objectiveText(done).startsWith("Completed"));
  const [failed] = visibleQuests(
    playerWith("q_pigeon_audit", "failed"),
    quests,
  );
  assert(objectiveText(failed).startsWith("Failed"));
});

Deno.test("advanceStage moves to the next stage without completing", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const { player, turnedIn, completedObjective } = advanceStage(
    playerWith("q_pigeon_audit", "accepted"),
    quest,
  );
  assertEquals(turnedIn, false);
  assertEquals(completedObjective, "Count the pigeons. All of them.");
  assertEquals(player.quests[0].stageIndex, 1);
  assertEquals(player.quests[0].status, "accepted");
});

Deno.test("advancing past the final stage turns the quest in and pays out", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  // Walk through all stages (3 stages for the pigeon audit).
  let player = playerWith("q_pigeon_audit", "accepted");
  let turnedIn = false;
  for (let i = 0; i < quest.stages.length; i++) {
    const res = advanceStage(player, quest);
    player = res.player;
    turnedIn = res.turnedIn;
  }
  assertEquals(turnedIn, true);
  assertEquals(player.quests[0].status, "completed");
  assertEquals(player.currency, 50);
  assert(player.inventory.includes("binoculars"));
});

Deno.test("advanceStage is a no-op for quests not held or already finished", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const notHeld = playerWith("q_form_27b", "accepted");
  assertEquals(advanceStage(notHeld, quest).player, notHeld);
  const done = playerWith("q_pigeon_audit", "completed");
  assertEquals(advanceStage(done, quest).player, done);
});
