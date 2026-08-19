/**
 * Dialogue tree traversal and quest-grant resolution (spec §3.1).
 * Pure logic: no oak, no storage imports.
 */
import type { DialogueNode, DialogueOption, Npc, Player, Quest } from "../types.ts";

export function getNode(npc: Npc, nodeId: string): DialogueNode | null {
  return npc.nodes.find((n) => n.id === nodeId) ?? null;
}

/**
 * Options visible at a node. An option that grants a quest is hidden only once
 * the quest is finished (completed or failed) — hidden quests are not
 * re-offered, and undiscovered quests are never marked as such. While the
 * quest is still accepted the option stays visible: it is the only path back
 * into the quest's dialogue branch, and hiding it would strand the quest
 * forever when the player leaves the branch early. Re-selecting it is safe —
 * resolveSelection never re-grants. An option that advances a quest is hidden
 * unless the player currently holds that quest as accepted (turn-in/stage
 * options only appear once the assignment exists); when the option declares
 * atStages, it is further gated to those stage indexes, so ordered steps
 * (process → sign → return) can't be skipped.
 */
export function availableOptions(
  npc: Npc,
  nodeId: string,
  player: Player,
): DialogueOption[] {
  const node = getNode(npc, nodeId);
  if (!node) return [];
  return node.options.filter((o) => {
    if (o.requiresQuestCompleted) {
      const prereq = player.quests.find((q) => q.questId === o.requiresQuestCompleted);
      if (!prereq || prereq.status !== "completed") return false;
    }
    if (o.grantsQuest) {
      const held = player.quests.find((q) => q.questId === o.grantsQuest);
      if (held && held.status !== "accepted") return false;
    }
    if (o.advancesQuest) {
      const held = player.quests.find(
        (q) => q.questId === o.advancesQuest && q.status === "accepted",
      );
      if (!held) return false;
      if (o.atStages && !o.atStages.includes(held.stageIndex)) return false;
    }
    return true;
  });
}

export interface SelectionResult {
  option: DialogueOption;
  /** The quest definition that was secretly assigned, if any. */
  grantedQuest: Quest | null;
  /** The quest definition this option advances/turns in, if any. */
  advancesQuest: Quest | null;
  /** True when the player already held the quest (should not happen if
   *  availableOptions was used to render choices). */
  alreadyHad: boolean;
}

/**
 * Resolve a selected option. If it carries a questId matching a known quest
 * the player doesn't have, the quest is revealed as newly accepted. If it
 * advances a quest, that quest definition is returned for stage progression.
 */
export function resolveSelection(
  npc: Npc,
  nodeId: string,
  optionId: string,
  player: Player,
  quests: Quest[],
): SelectionResult | null {
  const node = getNode(npc, nodeId);
  const option = node?.options.find((o) => o.id === optionId);
  if (!option) return null;

  const grantedQuest = option.grantsQuest
    ? quests.find((q) => q.id === option.grantsQuest) ?? null
    : null;
  const alreadyHad = option.grantsQuest
    ? player.quests.some((q) => q.questId === option.grantsQuest)
    : false;
  const advancesQuest = option.advancesQuest
    ? quests.find((q) => q.id === option.advancesQuest) ?? null
    : null;

  return {
    option,
    grantedQuest: alreadyHad ? null : grantedQuest,
    advancesQuest,
    alreadyHad,
  };
}

/**
 * Apply a granted quest to the player (spec §3.1 state machine:
 * undiscovered → accepted). Returns a new player object.
 */
export function acceptQuest(player: Player, quest: Quest): Player {
  if (player.quests.some((q) => q.questId === quest.id)) return player;
  return {
    ...player,
    quests: [...player.quests, { questId: quest.id, status: "accepted", stageIndex: 0 }],
  };
}

/** Advance a quest to completed, paying out its rewards. */
export function completeQuest(player: Player, quest: Quest): Player {
  const entry = player.quests.find((q) => q.questId === quest.id);
  if (!entry || entry.status !== "accepted") return player;
  return {
    ...player,
    currency: player.currency + quest.rewards.currency,
    inventory: [...player.inventory, ...quest.rewards.items],
    quests: player.quests.map((q) =>
      q.questId === quest.id ? { ...q, status: "completed" as const } : q
    ),
  };
}
