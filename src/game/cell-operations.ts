import type {
  Cell,
  CellOperationState,
  EspionageActionType,
  Player,
} from "../types.ts";
import { cellOperationSuspicionReduction } from "./item-effects.ts";
import { addMaterials } from "./materials.ts";

export const CELL_OPERATION_STAGES: Array<{
  action: EspionageActionType;
  label: string;
}> = [
  { action: "tail", label: "Map the courier route" },
  { action: "intercept", label: "Open the relay window" },
  { action: "gather_intel", label: "Extract the dossier" },
];

export function startCellOperation(
  cell: Cell,
  participants: Player[],
  now = Date.now(),
): CellOperationState | null {
  const [first] = participants;
  if (!first || participants.length < 2) return null;
  if (
    participants.some((player) =>
      !cell.memberIds.includes(player.id) || player.region !== first.region ||
      player.location !== first.location
    )
  ) return null;
  const timestamp = new Date(now).toISOString();
  return {
    cellId: cell.id,
    region: first.region,
    location: first.location,
    stageIndex: 0,
    status: "ongoing",
    participantIds: participants.map((player) => player.id),
    completedBy: [],
    log: [`${cell.name} opens a coordinated field operation.`],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface CellOperationTurn {
  state: CellOperationState;
  actor: Player;
  completed: boolean;
  reason: string | null;
}

export function advanceCellOperation(
  state: CellOperationState,
  actor: Player,
  action: EspionageActionType,
  now = Date.now(),
): CellOperationTurn | null {
  if (state.status !== "ongoing" || !state.participantIds.includes(actor.id)) {
    return null;
  }
  if (actor.region !== state.region || actor.location !== state.location) {
    return null;
  }
  const stage = CELL_OPERATION_STAGES[state.stageIndex];
  if (!stage || stage.action !== action) {
    return {
      state,
      actor,
      completed: false,
      reason: "That is not the current operation stage.",
    };
  }
  if (state.completedBy.at(-1) === actor.id) {
    return {
      state,
      actor,
      completed: false,
      reason: "Another cell member must take the next stage.",
    };
  }
  const nextStage = state.stageIndex + 1;
  const completed = nextStage >= CELL_OPERATION_STAGES.length;
  const log = [...state.log, `${actor.name}: ${stage.label}.`];
  if (completed) {
    log.push("The cell seals and distributes the recovered dossier.");
  }
  return {
    state: {
      ...state,
      stageIndex: nextStage,
      status: completed ? "completed" : "ongoing",
      completedBy: [...state.completedBy, actor.id],
      log,
      updatedAt: new Date(now).toISOString(),
    },
    actor: {
      ...actor,
      suspicion: Math.min(
        100,
        actor.suspicion + Math.max(
          0,
          4 - cellOperationSuspicionReduction(actor),
        ),
      ),
    },
    completed,
    reason: null,
  };
}

export function rewardCellOperation(player: Player, region: string): Player {
  return addMaterials({
    ...player,
    currency: player.currency + 20,
    intel: { ...player.intel, [region]: (player.intel[region] ?? 0) + 3 },
  }, { signal_crystal: 1 });
}
