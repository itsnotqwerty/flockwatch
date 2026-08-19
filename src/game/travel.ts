/**
 * Travel between regions (spec §3.0). Pure logic.
 * Travel has a cost scaled by distance and the destination's Flock presence —
 * crossing into a heavily-patrolled region is not free.
 */
import type { Player, Region } from "../types.ts";

/** Base cost to travel anywhere. */
export const BASE_TRAVEL_COST = 20;

/**
 * Bureaucrat's Stamp perk (spec §3.1 form-quest reward): official-looking
 * paperwork moves the bearer through checkpoints — travel costs are halved.
 */
export function hasBureaucratsStamp(player: Player): boolean {
  return player.inventory.includes("bureaucrats_stamp");
}

/** Regions known to the world map (ids). */
export function regionIndex(regions: Region[]): Map<string, Region> {
  return new Map(regions.map((r) => [r.id, r]));
}

/**
 * Cost to travel to a destination. Rises with the destination's Flock
 * presence (spec §3.0: travel is gated by risk). Halved for stamp bearers.
 */
export function travelCost(destination: Region, player?: Player): number {
  const base = BASE_TRAVEL_COST * (0.5 + destination.stats.flockPresence);
  return Math.round(player && hasBureaucratsStamp(player) ? base / 2 : base);
}

export interface TravelResult {
  ok: boolean;
  reason: string | null;
  player: Player;
}

/** Move the player to another region, charging the travel cost. */
export function travel(
  player: Player,
  destination: Region,
): TravelResult {
  if (player.region === destination.id) {
    return { ok: false, reason: "You are already there.", player };
  }
  const cost = travelCost(destination, player);
  if (player.currency < cost) {
    return { ok: false, reason: `Travel costs ${cost} credits. You have ${player.currency}.`, player };
  }
  return {
    ok: true,
    reason: null,
    player: { ...player, region: destination.id, currency: player.currency - cost },
  };
}
