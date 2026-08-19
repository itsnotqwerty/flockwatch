import { assert, assertEquals } from "$assert";
import {
  availableOptions,
  acceptQuest,
  completeQuest,
  getNode,
  resolveSelection,
} from "./dialogue.ts";
import { npcs, quests } from "./fixtures.ts";
import type { Player } from "../types.ts";

const groundskeeper = npcs.find((n) => n.id === "groundskeeper")!;

function freshPlayer(): Player {
  return {
    id: "test",
    name: "Tester",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
  };
}

Deno.test("getNode finds nodes and misses unknown ids", () => {
  assertEquals(getNode(groundskeeper, "start")?.id, "start");
  assertEquals(getNode(groundskeeper, "redacted"), null);
});

Deno.test("reset sentinel is preserved through resolveSelection", () => {
  // Build an NPC whose option sets next: "reset".
  const npc = {
    ...groundskeeper,
    nodes: [{
      id: "start",
      line: "Try again?",
      options: [{ id: "again", label: "Again", response: "Fine.", next: "reset" }],
    }],
  };
  const result = resolveSelection(npc, "start", "again", freshPlayer(), quests);
  assertEquals(result?.option.next, "reset");
});

Deno.test("hidden quest is granted only when its option is selected", () => {
  const player = freshPlayer();
  const result = resolveSelection(
    groundskeeper,
    "start",
    "ask_about_birds",
    player,
    quests,
  );
  assertEquals(result?.grantedQuest?.id, "q_pigeon_audit");
  assertEquals(result?.grantedQuest?.title, "The Pigeon Audit");
});

Deno.test("non-quest options grant nothing", () => {
  const result = resolveSelection(
    groundskeeper,
    "start",
    "leave",
    freshPlayer(),
    quests,
  );
  assertEquals(result?.grantedQuest, null);
  assertEquals(result?.option.next, null);
});

Deno.test("acceptQuest moves quest undiscovered → accepted", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  assertEquals(player.quests.length, 1);
  assertEquals(player.quests[0].status, "accepted");
  // Idempotent: accepting twice doesn't duplicate.
  assertEquals(acceptQuest(player, quest).quests.length, 1);
});

Deno.test("quest options are hidden after the quest is held", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  const options = availableOptions(groundskeeper, "start", player);
  assert(options.every((o) => o.id !== "ask_about_birds"));
  assertEquals(options.length, 2); // work + leave remain
});

Deno.test("resolveSelection flags already-held quests", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  const result = resolveSelection(
    groundskeeper,
    "start",
    "ask_about_birds",
    player,
    quests,
  );
  assertEquals(result?.grantedQuest, null);
  assertEquals(result?.alreadyHad, true);
});

Deno.test("completeQuest pays out rewards and marks completion", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  const done = completeQuest(player, quest);
  assertEquals(done.quests[0].status, "completed");
  assertEquals(done.currency, 50);
  assert(done.inventory.includes("binoculars"));
  // Completing a quest never accepted is a no-op.
  assertEquals(completeQuest(freshPlayer(), quest).quests.length, 0);
});

Deno.test("all content dialogue lines wrap within 40 columns", () => {
  for (const npc of npcs) {
    for (const node of npc.nodes) {
      for (const word of node.line.split(/\s+/)) {
        assert(word.length <= 40, `${npc.id}/${node.id}: word too long: ${word}`);
      }
      for (const opt of node.options) {
        for (const word of opt.response.split(/\s+/)) {
          assert(word.length <= 40, `${npc.id}/${opt.id}: word too long: ${word}`);
        }
      }
    }
  }
  // Every grantsQuest option has a matching quest with a matching trigger.
  for (const npc of npcs) {
    for (const node of npc.nodes) {
      for (const opt of node.options) {
        if (!opt.grantsQuest) continue;
        const quest = quests.find((q) => q.id === opt.grantsQuest);
        assert(quest, `missing quest for option ${opt.id}`);
        assertEquals(quest.trigger.npc, npc.id);
        assertEquals(quest.trigger.dialogueOption, opt.id);
      }
    }
  }
});
