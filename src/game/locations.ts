import type { LocationInteraction, Player, Sublocation } from "../types.ts";
import { environmentalMaterialBonus } from "./item-effects.ts";

export interface LocationTravelResult {
  ok: boolean;
  reason: string | null;
  player: Player;
}

export function travelWithinRegion(
  player: Player,
  destination: Sublocation,
): LocationTravelResult {
  if (destination.regionId !== player.region) {
    return {
      ok: false,
      reason: "That location is outside your current city.",
      player,
    };
  }
  if (destination.id === player.location) {
    return { ok: false, reason: "You are already there.", player };
  }
  return {
    ok: true,
    reason: null,
    player: { ...player, location: destination.id },
  };
}

export interface LocationActionResult {
  ok: boolean;
  reason: string | null;
  narrative: string;
  player: Player;
}

export function performLocationAction(
  player: Player,
  location: Sublocation,
  interaction: LocationInteraction,
): LocationActionResult {
  if (location.regionId !== player.region || location.id !== player.location) {
    return { ok: false, reason: "You are not there.", narrative: "", player };
  }
  if (interaction.kind !== "activity") {
    return {
      ok: false,
      reason: "That interaction is not a direct activity.",
      narrative: "",
      player,
    };
  }
  const actionKey = `${location.id}:${interaction.id}`;
  if (interaction.once && player.completedLocationActions.includes(actionKey)) {
    return {
      ok: false,
      reason: "You have already exhausted this opportunity.",
      narrative: interaction.result ?? "Nothing new presents itself.",
      player,
    };
  }
  const effect = interaction.effect ?? {};
  const currency = player.currency + (effect.currency ?? 0);
  if (currency < 0) {
    return {
      ok: false,
      reason: `This requires ${Math.abs(effect.currency ?? 0)} credits.`,
      narrative: "The transaction declines itself before you can.",
      player,
    };
  }
  const scrap = { ...player.scrap };
  for (const [component, amount] of Object.entries(effect.scrap ?? {})) {
    const key = component as keyof typeof scrap;
    scrap[key] = (scrap[key] ?? 0) + (amount ?? 0);
  }
  const firstMaterial = Object.keys(
    effect.scrap ?? {},
  )[0] as keyof typeof scrap;
  if (firstMaterial && environmentalMaterialBonus(player) > 0) {
    scrap[firstMaterial] = (scrap[firstMaterial] ?? 0) +
      environmentalMaterialBonus(player);
  }
  const intel = { ...player.intel };
  if (effect.intel) {
    intel[player.region] = (intel[player.region] ?? 0) + effect.intel;
  }
  const inventory = effect.item
    ? [...player.inventory, effect.item]
    : player.inventory;
  return {
    ok: true,
    reason: null,
    narrative: interaction.result ??
      "The activity concludes without a public report.",
    player: {
      ...player,
      currency,
      suspicion: Math.max(
        0,
        Math.min(100, player.suspicion + (effect.suspicion ?? 0)),
      ),
      scrap,
      intel,
      inventory,
      completedLocationActions: interaction.once
        ? [...player.completedLocationActions, actionKey]
        : player.completedLocationActions,
    },
  };
}
