/**
 * Crafting (spec §3.6.2, §4.5) — pure logic. Scrap components become items.
 */
import type { CraftingRecipe, Player, ScrapComponent } from "../types.ts";
import { craftingFeeReduction } from "./item-effects.ts";
import { MATERIAL_NAMES } from "./materials.ts";

export interface CraftResult {
  player: Player;
  crafted: string | null; // resulting item id, or null on failure
  reason: string | null; // why crafting failed, if it did
}

/** Workbench consumables licensing fee (§3.3 currency sink). */
export const CRAFT_FEE = 10;

export function craftingFee(player: Player): number {
  return Math.max(0, CRAFT_FEE - craftingFeeReduction(player));
}

/** True when the player holds enough of every required component. */
export function canCraft(player: Player, recipe: CraftingRecipe): boolean {
  return Object.entries(recipe.components).every(
    ([comp, need]) =>
      (player.scrap[comp as ScrapComponent] ?? 0) >= (need ?? 0),
  );
}

/** True when the player can pay the fee and cover the components. */
export function canAffordCraft(
  player: Player,
  recipe: CraftingRecipe,
): boolean {
  return canCraft(player, recipe) && player.currency >= craftingFee(player);
}

/**
 * Craft a recipe: pay the workbench licensing fee, consume the components
 * from scrap, and add the result item to inventory. Fails cleanly when
 * components or funds are short.
 */
export function craft(player: Player, recipe: CraftingRecipe): CraftResult {
  if (!canCraft(player, recipe)) {
    return { player, crafted: null, reason: "Missing components." };
  }
  const fee = craftingFee(player);
  if (player.currency < fee) {
    return {
      player,
      crafted: null,
      reason: `Workbench licensing fee is ${fee}cr.`,
    };
  }
  const scrap = { ...player.scrap };
  for (const [comp, need] of Object.entries(recipe.components)) {
    const key = comp as ScrapComponent;
    scrap[key] = (scrap[key] ?? 0) - (need ?? 0);
  }
  return {
    player: {
      ...player,
      scrap,
      currency: player.currency - fee,
      inventory: [...player.inventory, recipe.result],
    },
    crafted: recipe.result,
    reason: null,
  };
}

/** Describe a recipe's component cost, e.g. "2 circuit board, 3 copper wiring". */
export function describeCost(recipe: CraftingRecipe): string {
  return Object.entries(recipe.components)
    .map(([comp, n]) => `${n} ${MATERIAL_NAMES[comp as ScrapComponent]}`)
    .join(", ");
}
