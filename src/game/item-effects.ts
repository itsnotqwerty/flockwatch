import type { Player } from "../types.ts";

function has(player: Player, itemId: string): boolean {
  return player.inventory.includes(itemId);
}

export function combatDamageBonus(player: Player, cooperative = false): number {
  return (has(player, "shock_baton") ? 5 : 0) +
    (has(player, "demo_tape") ? 1 : 0) +
    (cooperative && has(player, "cell_relay") ? 3 : 0);
}

export function combatSuspicionReduction(player: Player): number {
  return (has(player, "covert_vest") ? 3 : 0) +
    (has(player, "lined_tinfoil_hat") ? 1 : 0);
}

export function cameraTakedownReduction(player: Player): number {
  return (has(player, "cutters") ? 8 : 0) +
    (has(player, "grounds_master_key") ? 1 : 0);
}

export function espionageOddsBonus(player: Player): number {
  return (has(player, "signal_jammer") ? 0.12 : 0) +
    (has(player, "gallery_lanyard") ? 0.05 : 0);
}

export function espionageSuspicionReduction(player: Player): number {
  return (has(player, "signal_jammer") ? 3 : 0) +
    (has(player, "covert_vest") ? 2 : 0);
}

export function travelMultiplier(player: Player): number {
  return (has(player, "temporary_flock_credential") ? 0.5 : 1) *
    (has(player, "transit_transponder") ? 0.75 : 1) *
    (has(player, "tide_tables") ? 0.9 : 1);
}

export function marketFeeReduction(player: Player): number {
  return (has(player, "valuation_lens") ? 0.10 : 0) +
    (has(player, "receipt_binder") ? 0.03 : 0) +
    (has(player, "insider_prospectus") ? 0.02 : 0);
}

export function craftingFeeReduction(player: Player): number {
  return (has(player, "field_toolkit") ? 5 : 0) +
    (has(player, "desk_stamp") ? 3 : 0);
}

export function environmentalMaterialBonus(player: Player): number {
  return (has(player, "survey_tripod") ? 1 : 0) +
    (has(player, "union_punch_card") ? 1 : 0);
}

export function cellOperationSuspicionReduction(player: Player): number {
  return has(player, "cell_relay") ? 2 : 0;
}

/**
 * Flat reduction applied to every suspicion gain from events (combat moves,
 * espionage, camera takedowns, cell operations, location activities). Stacks
 * with the domain-specific reductions above. Gain is always floored at 0.
 */
export function eventSuspicionReduction(player: Player): number {
  return has(player, "honorary_spy_badge") ? 1 : 0;
}
