/**
 * Shared, cached access to validated JSON content (design §4).
 */
import type { CraftingRecipe, Item, Npc, Quest, Region } from "../types.ts";
import { loadContentOrThrow } from "./load.ts";

type Content = {
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  items: Item[];
  recipes: CraftingRecipe[];
};

let cache: Content | null = null;

export async function getContent(): Promise<Content> {
  if (!cache) cache = await loadContentOrThrow();
  return cache;
}

export async function getQuests(): Promise<Quest[]> {
  return (await getContent()).quests;
}

export async function getNpcs(): Promise<Npc[]> {
  return (await getContent()).npcs;
}

export async function getRegionContent(): Promise<Region[]> {
  return (await getContent()).regions;
}

export async function getItems(): Promise<Item[]> {
  return (await getContent()).items;
}

export async function getRecipes(): Promise<CraftingRecipe[]> {
  return (await getContent()).recipes;
}

/** Reset the cache (tests / hot reload). */
export function clearContentCache(): void {
  cache = null;
}
