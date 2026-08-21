import type { Cell, CellEncounterState, Encounter, Player } from "../types.ts";
import {
  combatDamageBonus,
  combatSuspicionReduction,
  eventSuspicionReduction,
} from "./item-effects.ts";
import { addMaterials, formatMaterials } from "./materials.ts";

export function startCellEncounter(
  encounter: Encounter,
  cell: Cell,
  participants: Player[],
  now = Date.now(),
): CellEncounterState | null {
  if (encounter.kind !== "boss" || participants.length < 2) return null;
  const [first] = participants;
  if (!first || !encounter.regions.includes(first.region)) return null;
  if (
    participants.some((player) =>
      !cell.memberIds.includes(player.id) || player.region !== first.region ||
      player.location !== first.location
    )
  ) return null;
  const timestamp = new Date(now).toISOString();
  return {
    cellId: cell.id,
    encounterId: encounter.id,
    region: first.region,
    location: first.location,
    enemyHp: encounter.maxHp,
    status: "ongoing",
    phaseIndex: 0,
    participantIds: participants.map((player) => player.id),
    log: [`${cell.name} confronts ${encounter.name} as a cell.`],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export interface CellTurnResult {
  state: CellEncounterState;
  actor: Player;
  victory: boolean;
  reason: string | null;
}

export function applyCellMove(
  encounter: Encounter,
  state: CellEncounterState,
  actor: Player,
  moveId: string,
  now = Date.now(),
): CellTurnResult | null {
  if (state.status !== "ongoing" || !state.participantIds.includes(actor.id)) {
    return null;
  }
  if (actor.region !== state.region || actor.location !== state.location) {
    return null;
  }
  const move = encounter.moves.find((candidate) => candidate.id === moveId);
  if (!move) return null;
  if ((move.cost ?? 0) > actor.currency) {
    return {
      state,
      actor,
      victory: false,
      reason: "You cannot afford that move.",
    };
  }
  const updatedActor: Player = {
    ...actor,
    currency: actor.currency - (move.cost ?? 0),
    suspicion: Math.max(
      0,
      Math.min(
        100,
        actor.suspicion +
          (move.suspicion > 0
            ? Math.max(
              0,
              move.suspicion - combatSuspicionReduction(actor) -
                eventSuspicionReduction(actor),
            )
            : move.suspicion),
      ),
    ),
  };
  const log = [...state.log];
  let participantIds = state.participantIds;
  if (move.flees) {
    participantIds = participantIds.filter((id) => id !== actor.id);
    log.push(`${actor.name} requests an individual continuance.`);
    return {
      state: {
        ...state,
        participantIds,
        status: participantIds.length === 0 ? "defeat" : "ongoing",
        log,
        updatedAt: new Date(now).toISOString(),
      },
      actor: updatedActor,
      victory: false,
      reason: null,
    };
  }
  const damage = move.damage + combatDamageBonus(actor, true);
  const enemyHp = Math.max(0, state.enemyHp - damage);
  log.push(`${actor.name} uses ${move.label}: ${damage} damage.`);
  if (move.selfDamage > 0) {
    log.push(`${actor.name} absorbs ${move.selfDamage} in return.`);
  }
  let phaseIndex = state.phaseIndex;
  if (encounter.phases) {
    const fraction = enemyHp / encounter.maxHp;
    while (
      phaseIndex < encounter.phases.length &&
      fraction <= encounter.phases[phaseIndex].at
    ) {
      log.push(encounter.phases[phaseIndex].line);
      phaseIndex += 1;
    }
  }
  const victory = enemyHp === 0;
  if (victory) {
    log.push(encounter.victoryLine);
    log.push(
      `Recovered materials: ${formatMaterials(encounter.materialDrops)}.`,
    );
  }
  return {
    state: {
      ...state,
      enemyHp,
      status: victory ? "victory" : "ongoing",
      phaseIndex,
      log,
      updatedAt: new Date(now).toISOString(),
    },
    actor: updatedActor,
    victory,
    reason: null,
  };
}

export function rewardCellParticipant(
  player: Player,
  encounter: Encounter,
): Player {
  return addMaterials({
    ...player,
    currency: player.currency + encounter.payout,
    inventory: [...player.inventory, ...encounter.drops],
    suspicion: Math.max(0, player.suspicion - (encounter.clearsSuspicion ?? 0)),
  }, encounter.materialDrops);
}
