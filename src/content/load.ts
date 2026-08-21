/**
 * Content loader: reads region-namespaced JSON content files from content/
 * (design §4), validates them, and returns the assembled roster.
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
import {
  type ContentIssue,
  validateCrossReferences,
  validateDecrees,
  validateEncounters,
  validateItems,
  validateLocations,
  validateNpcs,
  validateQuests,
  validateRecipes,
  validateRegions,
} from "./validate.ts";

const CONTENT_DIR = new URL("../../content/", import.meta.url);

export interface LoadedContent {
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  locations: Sublocation[];
  items: Item[];
  recipes: CraftingRecipe[];
  decrees: Decree[];
  encounters: Encounter[];
  issues: ContentIssue[];
}

/** Load and validate all content files (design §4 naming conventions). */
export async function loadContent(): Promise<LoadedContent> {
  const npcs: Npc[] = [];
  const quests: Quest[] = [];
  const regions: Region[] = [];
  const locations: Sublocation[] = [];
  const items: Item[] = [];
  const recipes: CraftingRecipe[] = [];
  const decrees: Decree[] = [];
  const encounters: Encounter[] = [];
  const issues: ContentIssue[] = [];

  for await (const entry of Deno.readDir(CONTENT_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    if (
      /^(gulf_coast|new_york|pacific_northwest|rust_belt)\./.test(entry.name)
    ) continue;
    const url = new URL(entry.name, CONTENT_DIR);
    let data: unknown;
    try {
      data = JSON.parse(await Deno.readTextFile(url));
    } catch (err) {
      issues.push({
        file: entry.name,
        message: `invalid JSON: ${(err as Error).message}`,
      });
      continue;
    }
    if (entry.name.endsWith(".npcs.json")) {
      issues.push(...validateNpcs(data, entry.name));
      npcs.push(...(data as Npc[]));
    } else if (entry.name.endsWith(".quests.json")) {
      issues.push(...validateQuests(data, entry.name));
      quests.push(...(data as Quest[]));
    } else if (entry.name.endsWith(".region.json")) {
      issues.push(...validateRegions(data, entry.name));
      regions.push(...(data as Region[]));
    } else if (entry.name === "locations.json") {
      issues.push(...validateLocations(data, entry.name));
      locations.push(...(data as Sublocation[]));
    } else if (entry.name === "items.json") {
      issues.push(...validateItems(data, entry.name));
      items.push(...(data as Item[]));
    } else if (entry.name === "recipes.json") {
      issues.push(...validateRecipes(data, entry.name));
      recipes.push(...(data as CraftingRecipe[]));
    } else if (entry.name === "decrees.json") {
      issues.push(...validateDecrees(data, entry.name));
      decrees.push(...(data as Decree[]));
    } else if (entry.name === "encounters.json") {
      issues.push(...validateEncounters(data, entry.name));
      encounters.push(...(data as Encounter[]));
    }
  }

  if (issues.length === 0) {
    issues.push(
      ...validateCrossReferences(
        npcs,
        quests,
        regions,
        locations,
        items,
        recipes,
        encounters,
        "content/",
      ),
    );
  }
  return {
    npcs,
    quests,
    regions,
    locations,
    items,
    recipes,
    decrees,
    encounters,
    issues,
  };
}

/** Load content, throwing on any validation issue. */
export async function loadContentOrThrow(): Promise<{
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  locations: Sublocation[];
  items: Item[];
  recipes: CraftingRecipe[];
  decrees: Decree[];
  encounters: Encounter[];
}> {
  const {
    npcs,
    quests,
    regions,
    locations,
    items,
    recipes,
    decrees,
    encounters,
    issues,
  } = await loadContent();
  if (issues.length > 0) {
    const detail = issues.map((i) => `  ${i.file}: ${i.message}`).join("\n");
    throw new Error(`Content validation failed:\n${detail}`);
  }
  return {
    npcs,
    quests,
    regions,
    locations,
    items,
    recipes,
    decrees,
    encounters,
  };
}
