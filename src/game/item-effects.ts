import type { Player } from "../types.ts";

function has(player: Player, itemId: string): boolean {
  return player.inventory.includes(itemId);
}

export function combatDamageBonus(player: Player, cooperative = false): number {
  return (has(player, "shock_baton") ? 5 : 0) +
    (cooperative && has(player, "cell_relay") ? 3 : 0);
}

export function combatSuspicionReduction(player: Player): number {
  return has(player, "covert_vest") ? 3 : 0;
}

export function cameraTakedownReduction(player: Player): number {
  return has(player, "cutters") ? 8 : 0;
}

export function espionageOddsBonus(player: Player): number {
  return has(player, "signal_jammer") ? 0.12 : 0;
}

export function espionageSuspicionReduction(player: Player): number {
  return (has(player, "signal_jammer") ? 3 : 0) +
    (has(player, "covert_vest") ? 2 : 0);
}

export function travelMultiplier(player: Player): number {
  return has(player, "transit_transponder") ? 0.75 : 1;
}

export function marketFeeReduction(player: Player): number {
  return has(player, "valuation_lens") ? 0.10 : 0;
}

export function craftingFeeReduction(player: Player): number {
  return has(player, "field_toolkit") ? 5 : 0;
}

export function environmentalMaterialBonus(player: Player): number {
  return has(player, "survey_tripod") ? 1 : 0;
}

export function cellOperationSuspicionReduction(player: Player): number {
  return has(player, "cell_relay") ? 2 : 0;
}
