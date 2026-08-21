import { assert, assertEquals } from "$assert";
import {
  acceptQuest,
  availableOptions,
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
    region: "cleveland",
    location: "cuyahoga_rolling_mill",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
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
      options: [{
        id: "again",
        label: "Again",
        response: "Fine.",
        next: "reset",
      }],
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

Deno.test("quest options stay visible while the quest is accepted", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  const options = availableOptions(groundskeeper, "start", player);
  // The grant option must remain reachable: it is the only path back into
  // the branch holding the advance option, and re-selecting it never
  // re-grants (resolveSelection flags alreadyHad).
  assert(options.some((o) => o.id === "ask_about_birds"));
  assertEquals(options.length, 3);
});

Deno.test("quest options are hidden once the quest is finished", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = completeQuest(acceptQuest(freshPlayer(), quest), quest);
  const options = availableOptions(groundskeeper, "start", player);
  assert(options.every((o) => o.id !== "ask_about_birds"));
  assertEquals(options.length, 2); // work + leave remain
});

Deno.test("advance node stays reachable after leaving the branch early", () => {
  const quest = quests.find((q) => q.id === "q_pigeon_audit")!;
  const player = acceptQuest(freshPlayer(), quest);
  // Player accepted the quest, then picked "What new ones?" (next: null) —
  // the conversation ended before they could report the count.
  // Re-entering the conversation must still expose the advance option.
  const startOptions = availableOptions(groundskeeper, "start", player);
  const reentry = startOptions.find((o) => o.id === "ask_about_birds");
  assert(reentry, "grant option should re-open the quest branch");
  const result = resolveSelection(
    groundskeeper,
    "start",
    reentry.id,
    player,
    quests,
  );
  assertEquals(result?.grantedQuest, null);
  assertEquals(result?.alreadyHad, true);
  assertEquals(result?.option.next, "birds");
  const birdsOptions = availableOptions(groundskeeper, "birds", player);
  assert(birdsOptions.some((o) => o.advancesQuest === "q_pigeon_audit"));
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
  assertEquals(done.scrap.lens, 1);
  assertEquals(done.scrap.ballistic_fiber, 1);
  // Completing a quest never accepted is a no-op.
  assertEquals(completeQuest(freshPlayer(), quest).quests.length, 0);
});

Deno.test("all content dialogue lines wrap within 40 columns", () => {
  for (const npc of npcs) {
    for (const node of npc.nodes) {
      for (const word of node.line.split(/\s+/)) {
        assert(
          word.length <= 40,
          `${npc.id}/${node.id}: word too long: ${word}`,
        );
      }
      for (const opt of node.options) {
        for (const word of opt.response.split(/\s+/)) {
          assert(
            word.length <= 40,
            `${npc.id}/${opt.id}: word too long: ${word}`,
          );
        }
      }
    }
  }
  // Every grantsQuest option has a matching quest with a matching trigger.
  // A quest may be shared across an NPC family (e.g. every clerk grants the
  // form quest), so the trigger matches either the npc id or the art family.
  for (const npc of npcs) {
    for (const node of npc.nodes) {
      for (const opt of node.options) {
        if (!opt.grantsQuest) continue;
        const quest = quests.find((q) => q.id === opt.grantsQuest);
        assert(quest, `missing quest for option ${opt.id}`);
        assert(
          quest.trigger.npc === npc.id || quest.trigger.npc === npc.art,
          `${opt.grantsQuest} trigger "${quest.trigger.npc}" matches neither ${npc.id} nor art ${npc.art}`,
        );
        assertEquals(quest.trigger.dialogueOption, opt.id);
      }
    }
  }
});

Deno.test("requiresQuestCompleted hides follow-up quests until the prereq is done", () => {
  const horse = npcs.find((n) => n.id === "cyberhorse")!;
  const first = quests.find((q) => q.id === "q_cyberhorse")!;

  // No progress on the first quest: the follow-up is hidden.
  let options = availableOptions(horse, "start", freshPlayer());
  assert(options.every((o) => o.id !== "ask_quest_again"));

  // Accepted but not completed: still hidden.
  let player = acceptQuest(freshPlayer(), first);
  options = availableOptions(horse, "start", player);
  assert(options.every((o) => o.id !== "ask_quest_again"));

  // Completed: the follow-up appears and grants the chained quest.
  player = completeQuest(player, first);
  options = availableOptions(horse, "start", player);
  const followUp = options.find((o) => o.id === "ask_quest_again");
  assert(followUp, "follow-up quest option should appear after completion");
  const result = resolveSelection(horse, "start", followUp.id, player, quests);
  assertEquals(result?.grantedQuest?.id, "q_cyberhorse2");
});

Deno.test("atStages gates advance options to specific quest stages", () => {
  const clerk = npcs.find((n) => n.id === "clerk")!;
  const langley = npcs.find((n) => n.id === "atl_garrett")!;
  const quest = quests.find((q) => q.id === "q_form_27b")!;

  // Stage 0: clerks can process the form, but the signature option is hidden
  // and the turn-in option is hidden.
  let player = acceptQuest(freshPlayer(), quest);
  let clerkOptions = availableOptions(clerk, "start", player);
  assert(clerkOptions.some((o) => o.id === "process_form_27b"));
  assert(clerkOptions.every((o) => o.id !== "turn_in_form_27b"));
  assert(
    availableOptions(langley, "start", player).every((o) =>
      o.id !== "get_signature"
    ),
  );

  // Stage 2: the agent's signature becomes available; processing is done.
  player = {
    ...player,
    quests: [{ questId: quest.id, status: "accepted", stageIndex: 2 }],
  };
  assert(
    availableOptions(langley, "start", player).some((o) =>
      o.id === "get_signature"
    ),
  );
  clerkOptions = availableOptions(clerk, "start", player);
  assert(clerkOptions.every((o) => o.id !== "process_form_27b"));
  assert(clerkOptions.every((o) => o.id !== "turn_in_form_27b"));

  // Stage 3 (final): any clerk accepts the signed form for turn-in.
  player = {
    ...player,
    quests: [{ questId: quest.id, status: "accepted", stageIndex: 3 }],
  };
  clerkOptions = availableOptions(clerk, "start", player);
  assert(clerkOptions.some((o) => o.id === "turn_in_form_27b"));
  assert(clerkOptions.every((o) => o.id !== "process_form_27b"));
});
