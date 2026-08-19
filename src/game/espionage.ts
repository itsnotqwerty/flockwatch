/**
 * Espionage (spec §3.5) — pure logic. Players tail NPCs, intercept
 * communications, and gather intel. Every operation carries a risk of being
 * blown, which leaves a persistent flag with in-world consequences.
 */
import type { EspionageActionType, EspionageFlag, Player, Region } from "../types.ts";

let flagCounter = 0;

/** Reset the flag id counter (tests). */
export function resetFlagCounter(): void {
  flagCounter = 0;
}

export interface EspionageOutcome {
  ok: boolean;
  success: boolean;
  player: Player;
  /** Intel gained on success. */
  intel: number;
  /** Currency gained on success (intercepts only). */
  payout: number;
  flag: EspionageFlag | null;
  narrative: string;
}

/** Suspicion above which espionage is too hot to attempt. */
export const ESPIONAGE_SUSPICION_CAP = 80;

/** Regions in this list refuse the player entirely (spec §3.5 restricted areas). */
export function isRestricted(player: Player, region: string): boolean {
  return player.restricted.includes(region);
}

/** Flagged players pay a surcharge on every market purchase. */
export function marketFeeRate(player: Player): number {
  return player.flags.length === 0 ? 0 : Math.min(0.25, 0.10 + player.flags.length * 0.05);
}

const NARRATIVE: Record<EspionageActionType, { ok: string; blown: string }> = {
  tail: {
    ok: "You keep three lampposts between you and the mark. Their route is logged.",
    blown: "The mark stops dead and stares directly at you. You have been made.",
  },
  intercept: {
    ok: "The relay chatters. You skim the traffic before the censors wake up.",
    blown: "The channel was a canary trap. Somewhere, a file with your name gets thicker.",
  },
  gather_intel: {
    ok: "A clerk leaves a cabinet unlocked. The dossier grows.",
    blown: "The cabinet was bait. A camera you never saw blinks red.",
  },
};

/**
 * Attempt an espionage action. Success odds fall with the region's Flock
 * presence and the player's suspicion; each existing flag makes the next
 * operation riskier. `roll` is a 0–1 random value (injectable for tests).
 */
export function performEspionage(
  action: EspionageActionType,
  player: Player,
  region: Region,
  roll: number,
): EspionageOutcome {
  if (isRestricted(player, region.id)) {
    return {
      ok: false,
      success: false,
      player,
      intel: 0,
      payout: 0,
      flag: null,
      narrative: "The checkpoints here have your photograph. You do not linger.",
    };
  }
  if (player.suspicion >= ESPIONAGE_SUSPICION_CAP) {
    return {
      ok: false,
      success: false,
      player,
      intel: 0,
      payout: 0,
      flag: null,
      narrative: "You are too hot for fieldwork. Lie low.",
    };
  }

  // Success odds: base 70%, minus Flock presence and suspicion pressure.
  const odds = 0.70 - region.stats.flockPresence * 0.25 - player.suspicion / 400
    - player.flags.length * 0.05;
  const success = roll < Math.max(0.1, odds);

  if (!success) {
    flagCounter += 1;
    const flag: EspionageFlag = {
      id: `flag_${flagCounter}`,
      region: region.id,
      action,
      reason: `Blown ${action.replace("_", " ")} in ${region.name}`,
      flaggedAt: new Date().toISOString(),
    };
    const updated: Player = {
      ...player,
      suspicion: player.suspicion + 15,
      flags: [...player.flags, flag],
      // A second flag in the same region gets the player restricted from it.
      restricted: player.flags.some((f) => f.region === region.id) &&
          !player.restricted.includes(region.id)
        ? [...player.restricted, region.id]
        : player.restricted,
    };
    return {
      ok: true,
      success: false,
      player: updated,
      intel: 0,
      payout: 0,
      flag,
      narrative: NARRATIVE[action].blown,
    };
  }

  const intel = action === "gather_intel" ? 2 : 1;
  const payout = action === "intercept" ? 15 : 0;
  const updated: Player = {
    ...player,
    currency: player.currency + payout,
    suspicion: Math.max(0, player.suspicion + 5),
    intel: { ...player.intel, [region.id]: (player.intel[region.id] ?? 0) + intel },
  };
  return {
    ok: true,
    success: true,
    player: updated,
    intel,
    payout,
    flag: null,
    narrative: NARRATIVE[action].ok,
  };
}
