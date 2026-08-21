import type { LocationInteractionKind, Player, Sublocation } from "../types.ts";

/**
 * Server-side capability check for sublocation-bound actions. The UI only
 * advertises these actions in the right place, but POST bodies are untrusted.
 */
export function locationSupports(
  player: Player,
  location: Sublocation | null,
  kind: LocationInteractionKind,
): boolean {
  return !!location && location.id === player.location &&
    location.regionId === player.region &&
    location.interactions.some((interaction) => interaction.kind === kind);
}
