/** Progress action-driven quest stages from completed, server-verified events. */
import type { Player, Quest, QuestEvent, QuestStage } from "../types.ts";
import { advanceStage } from "./quests.ts";

function matches(stage: QuestStage | undefined, event: QuestEvent): boolean {
  const requirement = stage?.requirement;
  return !!requirement && requirement.event === event.type &&
    (!requirement.region || requirement.region === event.region) &&
    (!requirement.target || requirement.target === event.target);
}

export interface QuestEventResult {
  player: Player;
  /** Quest ids whose current objective was completed by this event. */
  advancedQuestIds: string[];
}

/**
 * Apply one gameplay event to every accepted quest whose current stage asks
 * for it. The caller is responsible for emitting events only after the
 * underlying action has succeeded.
 */
export function recordQuestEvent(
  player: Player,
  quests: Quest[],
  event: QuestEvent,
): QuestEventResult {
  let updated = player;
  const advancedQuestIds: string[] = [];
  for (const held of player.quests) {
    if (held.status !== "accepted") continue;
    const quest = quests.find((candidate) => candidate.id === held.questId);
    if (!quest || !matches(quest.stages[held.stageIndex], event)) continue;
    updated = advanceStage(updated, quest).player;
    advancedQuestIds.push(quest.id);
  }
  return { player: updated, advancedQuestIds };
}
