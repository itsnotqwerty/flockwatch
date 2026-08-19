/**
 * Content loader: reads region-namespaced JSON content files from content/
 * (design §4), validates them, and returns the assembled roster.
 */
import type { CraftingRecipe, Item, Npc, Quest, Region } from "../types.ts";
import {
  validateCrossReferences,
  validateItems,
  validateNpcs,
  validateQuests,
  validateRecipes,
  validateRegions,
  type ContentIssue,
} from "./validate.ts";

const CONTENT_DIR = new URL("../../content/", import.meta.url);

export interface LoadedContent {
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  items: Item[];
  recipes: CraftingRecipe[];
  issues: ContentIssue[];
}

/** Load and validate all content files (design §4 naming conventions). */
export async function loadContent(): Promise<LoadedContent> {
  const npcs: Npc[] = [];
  const quests: Quest[] = [];
  const regions: Region[] = [];
  const items: Item[] = [];
  const recipes: CraftingRecipe[] = [];
  const issues: ContentIssue[] = [];

  for await (const entry of Deno.readDir(CONTENT_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const url = new URL(entry.name, CONTENT_DIR);
    let data: unknown;
    try {
      data = JSON.parse(await Deno.readTextFile(url));
    } catch (err) {
      issues.push({ file: entry.name, message: `invalid JSON: ${(err as Error).message}` });
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
    } else if (entry.name === "items.json") {
      issues.push(...validateItems(data, entry.name));
      items.push(...(data as Item[]));
    } else if (entry.name === "recipes.json") {
      issues.push(...validateRecipes(data, entry.name));
      recipes.push(...(data as CraftingRecipe[]));
    }
  }

  if (issues.length === 0) {
    issues.push(...validateCrossReferences(npcs, quests, "content/"));
  }
  return { npcs, quests, regions, items, recipes, issues };
}

/** Load content, throwing on any validation issue. */
export async function loadContentOrThrow(): Promise<{
  npcs: Npc[];
  quests: Quest[];
  regions: Region[];
  items: Item[];
  recipes: CraftingRecipe[];
}> {
  const { npcs, quests, regions, items, recipes, issues } = await loadContent();
  if (issues.length > 0) {
    const detail = issues.map((i) => `  ${i.file}: ${i.message}`).join("\n");
    throw new Error(`Content validation failed:\n${detail}`);
  }
  return { npcs, quests, regions, items, recipes };
}
