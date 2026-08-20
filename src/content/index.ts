/**
 * Shared, cached access to validated JSON content (design §4).
 */
import type {
  CraftingRecipe,
  Decree,
  Encounter,
  Item,
  Npc,
  Quest,
  Region,
  Sublocation,
} from "../types.ts";
import { loadContentOrThrow } from "./load.ts";

type Content = {
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  locations: Sublocation[];
  items: Item[];
  recipes: CraftingRecipe[];
  decrees: Decree[];
  encounters: Encounter[];
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

export async function getLocations(): Promise<Sublocation[]> {
  return (await getContent()).locations;
}

export async function getLocation(id: string): Promise<Sublocation | null> {
  return (await getLocations()).find((location) => location.id === id) ?? null;
}

export async function getItems(): Promise<Item[]> {
  return (await getContent()).items;
}

export async function getRecipes(): Promise<CraftingRecipe[]> {
  return (await getContent()).recipes;
}

export async function getDecrees(): Promise<Decree[]> {
  return (await getContent()).decrees;
}

export async function getEncounters(): Promise<Encounter[]> {
  return (await getContent()).encounters;
}

/** Reset the cache (tests / hot reload). */
export function clearContentCache(): void {
  cache = null;
}
