/**
 * Hidden quest log view (spec §3.1). Pure logic.
 */
import type { Player, PlayerQuest, Quest } from "../types.ts";

export interface QuestLogEntry {
  quest: Quest;
  state: PlayerQuest;
}

/**
 * The player's visible quest log. Undiscovered quests are NEVER listed;
 * hidden quests appear only after being accepted through dialogue.
 */
export function visibleQuests(player: Player, quests: Quest[]): QuestLogEntry[] {
  const byId = new Map(quests.map((q) => [q.id, q]));
  return player.quests
    .map((state) => {
      const quest = byId.get(state.questId);
      return quest ? { quest, state } : null;
    })
    .filter((e): e is QuestLogEntry => e !== null);
}

/** Current objective text for a quest in progress, or a status line. */
export function objectiveText(entry: QuestLogEntry): string {
  const { quest, state } = entry;
  if (state.status === "completed") return "Completed. The Forms thank you.";
  if (state.status === "failed") return "Failed. The Forms remember.";
  const stage = quest.stages[state.stageIndex];
  return stage ? stage.objective : "Await further instructions.";
}

export interface StageAdvance {
  player: Player;
  /** True when advancing past the final stage turned the quest in. */
  turnedIn: boolean;
  /** The objective just completed (for the response text). */
  completedObjective: string | null;
}

/**
 * Advance an accepted quest by one stage. Advancing past the final stage
 * turns the quest in: status becomes "completed" and rewards are paid.
 * No-op for quests the player does not hold or has already finished.
 */
export function advanceStage(player: Player, quest: Quest): StageAdvance {
  const entry = player.quests.find((q) => q.questId === quest.id);
  if (!entry || entry.status !== "accepted") {
    return { player, turnedIn: false, completedObjective: null };
  }

  const completedObjective = quest.stages[entry.stageIndex]?.objective ?? null;
  const nextIndex = entry.stageIndex + 1;

  if (nextIndex >= quest.stages.length) {
    // Turn-in: complete and pay out.
    const updated: Player = {
      ...player,
      currency: player.currency + quest.rewards.currency,
      inventory: [...player.inventory, ...quest.rewards.items],
      quests: player.quests.map((q) =>
        q.questId === quest.id ? { ...q, status: "completed" as const } : q
      ),
    };
    return { player: updated, turnedIn: true, completedObjective };
  }

  const updated: Player = {
    ...player,
    quests: player.quests.map((q) =>
      q.questId === quest.id ? { ...q, stageIndex: nextIndex } : q
    ),
  };
  return { player: updated, turnedIn: false, completedObjective };
}
