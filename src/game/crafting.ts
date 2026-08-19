/**
 * Crafting (spec §3.6.2, §4.5) — pure logic. Scrap components become items.
 */
import type { CraftingRecipe, Player, ScrapComponent } from "../types.ts";

export interface CraftResult {
  player: Player;
  crafted: string | null; // resulting item id, or null on failure
  reason: string | null;  // why crafting failed, if it did
}

/** Workbench consumables licensing fee (§3.3 currency sink). */
export const CRAFT_FEE = 10;

/** True when the player holds enough of every required component. */
export function canCraft(player: Player, recipe: CraftingRecipe): boolean {
  return Object.entries(recipe.components).every(
    ([comp, need]) => (player.scrap[comp as ScrapComponent] ?? 0) >= (need ?? 0),
  );
}

/** True when the player can pay the fee and cover the components. */
export function canAffordCraft(player: Player, recipe: CraftingRecipe): boolean {
  return canCraft(player, recipe) && player.currency >= CRAFT_FEE;
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
  if (player.currency < CRAFT_FEE) {
    return { player, crafted: null, reason: `Workbench licensing fee is ${CRAFT_FEE}cr.` };
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
      currency: player.currency - CRAFT_FEE,
      inventory: [...player.inventory, recipe.result],
    },
    crafted: recipe.result,
    reason: null,
  };
}

/** Describe a recipe's component cost, e.g. "2 circuit_board, 3 wiring". */
export function describeCost(recipe: CraftingRecipe): string {
  return Object.entries(recipe.components)
    .map(([comp, n]) => `${n} ${comp}`)
    .join(", ");
}
