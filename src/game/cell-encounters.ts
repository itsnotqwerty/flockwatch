import type {
  Cell,
  CellEncounterState,
  Encounter,
  Item,
  Player,
} from "../types.ts";
import { applyWipe, playerHp } from "./encounters.ts";
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
    defeatedIds: [],
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
  enemyRoll = Math.random(),
  items: Item[] = [],
): CellTurnResult | null {
  if (state.status !== "ongoing" || !state.participantIds.includes(actor.id)) {
    return null;
  }
  if (actor.region !== state.region || actor.location !== state.location) {
    return null;
  }
  const defeatedIds = state.defeatedIds ?? [];
  if (defeatedIds.includes(actor.id)) return null;
  const otherActive = state.participantIds.some((id) =>
    id !== actor.id && !defeatedIds.includes(id)
  );
  if (otherActive && state.lastActorId === actor.id) {
    return {
      state,
      actor,
      victory: false,
      reason: "Another active cell member must take the next turn.",
    };
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
  let updatedActor: Player = {
    ...actor,
    currency: actor.currency - (move.cost ?? 0),
    hp: Math.max(0, playerHp(actor) - move.selfDamage),
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
        lastActorId: actor.id,
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
  } else {
    const counter = encounter.enemyMoves.length > 0
      ? encounter.enemyMoves[
        Math.min(
          encounter.enemyMoves.length - 1,
          Math.floor(Math.max(0, enemyRoll) * encounter.enemyMoves.length),
        )
      ]
      : null;
    if (counter) {
      updatedActor = {
        ...updatedActor,
        hp: Math.max(0, playerHp(updatedActor) - counter.damage),
        suspicion: Math.max(
          0,
          Math.min(100, updatedActor.suspicion + counter.suspicion),
        ),
      };
      log.push(`${encounter.name} answers ${actor.name}: ${counter.label}.`);
      if (counter.damage > 0) {
        log.push(`${actor.name} takes ${counter.damage} damage.`);
      }
    }
  }
  const actorDefeated = !victory && playerHp(updatedActor) <= 0;
  const nextDefeatedIds = actorDefeated && !defeatedIds.includes(actor.id)
    ? [...defeatedIds, actor.id]
    : defeatedIds;
  if (actorDefeated) {
    updatedActor = applyWipe(updatedActor, items);
    log.push(
      `${actor.name} is removed from the operation and wakes elsewhere.`,
    );
  }
  const allDefeated = state.participantIds.every((id) =>
    nextDefeatedIds.includes(id)
  );
  if (allDefeated) log.push(encounter.defeatLine);
  return {
    state: {
      ...state,
      enemyHp,
      status: victory ? "victory" : allDefeated ? "defeat" : "ongoing",
      phaseIndex,
      defeatedIds: nextDefeatedIds,
      lastActorId: actor.id,
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
