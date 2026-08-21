/**
 * Encounters (spec §3.4) — pure logic. Turn-based text encounters driven by
 * move choices; enemies include region-stat-gated patrols and multi-phase
 * bosses. All rendering stays in the view layer.
 */
import type { Encounter, EncounterState, Player, Region } from "../types.ts";
import {
  combatDamageBonus,
  combatSuspicionReduction,
  eventSuspicionReduction,
} from "./item-effects.ts";
import { addMaterials, formatMaterials } from "./materials.ts";

/** Player field HP. Defeats happen at 0. */
export const PLAYER_HP = 40;

/** Current player HP; legacy saves without the field count as full. */
export function playerHp(player: Player): number {
  return player.hp ?? PLAYER_HP;
}

/** Cost of a hotel stay, which fully restores HP. Available in every city. */
export const REST_COST = 30;

/**
 * Stay at a hotel: spend REST_COST credits to restore HP to full. Returns
 * null when the player can't afford it or is already fully rested.
 */
export function restAtHotel(player: Player): Player | null {
  if (player.currency < REST_COST) return null;
  if (playerHp(player) >= PLAYER_HP) return null;
  return {
    ...player,
    currency: player.currency - REST_COST,
    hp: PLAYER_HP,
  };
}

/**
 * Pick a random combat quip for an enemy. `roll` is 0–1 (injectable);
 * returns null when the encounter defines no quips.
 */
export function pickQuip(encounter: Encounter, roll: number): string | null {
  if (!encounter.quips || encounter.quips.length === 0) return null;
  const i = Math.min(
    encounter.quips.length - 1,
    Math.floor(Math.max(0, roll) * encounter.quips.length),
  );
  return encounter.quips[i];
}

/**
 * Which encounters can spawn in a region. Patrols gate on the region's Flock
 * presence (spec §3.4: high-coverage regions spawn patrol encounters); bosses
 * never gate. Restricted regions suppress all spawns for the flagged player.
 */
export function eligibleEncounters(
  encounters: Encounter[],
  region: Region,
  player: Player,
): Encounter[] {
  if (player.restricted.includes(region.id)) return [];
  return encounters.filter((e) => {
    if (!e.regions.includes(region.id)) return false;
    if (e.kind === "patrol") {
      return region.stats.flockPresence >= e.minFlockPresence;
    }
    return true;
  });
}

/** Roll a patrol encounter for a region. `roll` is 0–1 (injectable). */
export function rollEncounter(
  encounters: Encounter[],
  region: Region,
  player: Player,
  roll: number,
): Encounter | null {
  const eligible = eligibleEncounters(encounters, region, player)
    .filter((e) => e.kind === "patrol");
  if (eligible.length === 0) return null;
  // Spawn chance scales with Flock presence above the minimum threshold.
  const chance = Math.max(0, region.stats.flockPresence - 0.2) * 0.5;
  if (roll >= chance) return null;
  return eligible[
    Math.floor((roll / Math.max(chance, 1e-9)) * eligible.length) %
    eligible.length
  ];
}

/** Begin an encounter instance for a player. `roll` picks the opening quip. */
export function startEncounter(
  encounter: Encounter,
  player: Player,
  roll: number = Math.random(),
): EncounterState {
  const log = [`${encounter.name} blocks your path.`];
  const quip = pickQuip(encounter, roll);
  return {
    encounterId: encounter.id,
    playerId: player.id,
    region: player.region,
    enemyHp: encounter.maxHp,
    status: "ongoing",
    phaseIndex: 0,
    log,
    ...(quip ? { quip } : {}),
  };
}

export interface TurnResult {
  state: EncounterState;
  player: Player;
  /** Boss phase-change announcement, if this turn crossed a threshold. */
  phaseLine: string | null;
  /** Move label, echoed for rendering. */
  moveLabel: string;
}

/**
 * Apply a player move to an ongoing encounter. Pure: returns the next state
 * and the updated player. Unknown moves or finished encounters are no-ops.
 */
export function applyMove(
  encounter: Encounter,
  state: EncounterState,
  player: Player,
  moveId: string,
  roll: number = Math.random(),
): TurnResult | null {
  if (state.status !== "ongoing") return null;
  const move = encounter.moves.find((m) => m.id === moveId);
  if (!move) return null;

  let updated: Player = {
    ...player,
    hp: Math.max(0, playerHp(player) - move.selfDamage),
    suspicion: Math.max(
      0,
      player.suspicion +
        (move.suspicion > 0
          ? Math.max(
            0,
            move.suspicion - combatSuspicionReduction(player) -
              eventSuspicionReduction(player),
          )
          : move.suspicion),
    ),
    currency: Math.max(0, player.currency - (move.cost ?? 0)),
  };

  if (move.flees) {
    return {
      state: {
        ...state,
        status: "fled",
        log: [...state.log, "You slip away. They let you."],
      },
      player: updated,
      phaseLine: null,
      moveLabel: move.label,
    };
  }

  const damage = move.damage + combatDamageBonus(player);
  const enemyHp = Math.max(0, state.enemyHp - damage);

  // Boss phase thresholds (spec §3.4 multi-phase bosses).
  let phaseLine: string | null = null;
  let phaseIndex = state.phaseIndex;
  if (encounter.phases) {
    const fraction = enemyHp / encounter.maxHp;
    while (
      phaseIndex < encounter.phases.length &&
      fraction <= encounter.phases[phaseIndex].at
    ) {
      phaseLine = encounter.phases[phaseIndex].line;
      phaseIndex += 1;
    }
  }

  const log = [...state.log];
  log.push(`${move.label}: ${damage} damage to ${encounter.name}.`);
  if (move.selfDamage > 0) log.push(`You take ${move.selfDamage} in return.`);
  if (phaseLine) log.push(phaseLine);

  let status: EncounterState["status"] = state.status;
  if (enemyHp <= 0) {
    status = "victory";
    log.push(encounter.victoryLine);
    log.push(
      `Recovered materials: ${formatMaterials(encounter.materialDrops)}.`,
    );
    updated = addMaterials({
      ...updated,
      currency: updated.currency + encounter.payout,
      inventory: [...updated.inventory, ...encounter.drops],
      suspicion: Math.max(
        0,
        updated.suspicion - (encounter.clearsSuspicion ?? 0),
      ),
      intel: move.intel
        ? {
          ...updated.intel,
          [state.region]: (updated.intel[state.region] ?? 0) + move.intel,
        }
        : updated.intel,
    }, encounter.materialDrops);
  } else if (move.selfDamage > 0 && updated.hp! <= 0) {
    // Attrition defeat: the player ran out of HP.
    status = "defeat";
    log.push(encounter.defeatLine);
  } else {
    // Standing defeat: the patrol simply outlasts you at 0 "composure" — we
    // model composure as suspicion hitting the cap from move spam.
    if (updated.suspicion >= 100) {
      status = "defeat";
      log.push(encounter.defeatLine);
    }
  }

  if (status === "ongoing") {
    const quip = pickQuip(encounter, roll);
    if (quip) {
      return {
        state: { ...state, enemyHp, status, phaseIndex, log, quip },
        player: updated,
        phaseLine,
        moveLabel: move.label,
      };
    }
  }

  return {
    state: { ...state, enemyHp, status, phaseIndex, log },
    player: updated,
    phaseLine,
    moveLabel: move.label,
  };
}
