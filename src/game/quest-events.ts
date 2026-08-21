/** Progress action-driven quest stages from completed, server-verified events. */
import type {
  Player,
  Quest,
  QuestEvent,
  QuestProgressNotification,
  QuestStage,
} from "../types.ts";
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
  notifications: QuestProgressNotification[];
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
  const notifications: QuestProgressNotification[] = [];
  for (const held of player.quests) {
    if (held.status !== "accepted") continue;
    const quest = quests.find((candidate) => candidate.id === held.questId);
    if (!quest || !matches(quest.stages[held.stageIndex], event)) continue;
    const advancement = advanceStage(updated, quest);
    updated = advancement.player;
    const state = updated.quests.find((candidate) =>
      candidate.questId === quest.id
    );
    const notification: QuestProgressNotification = {
      questId: quest.id,
      questTitle: quest.title,
      completedObjective: advancement.completedObjective ??
        quest.stages[held.stageIndex].objective,
      nextObjective: advancement.turnedIn
        ? null
        : quest.stages[state?.stageIndex ?? held.stageIndex + 1]?.objective ??
          null,
    };
    notifications.push(notification);
    updated = {
      ...updated,
      questNotifications: [
        ...(updated.questNotifications ?? []),
        notification,
      ],
    };
    advancedQuestIds.push(quest.id);
  }
  return { player: updated, advancedQuestIds, notifications };
}
