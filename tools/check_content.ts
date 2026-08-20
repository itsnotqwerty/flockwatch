/**
 * Content schema check (design §4): validate all JSON content files.
 * Exits non-zero if any file has issues. Run before merging content changes.
 *
 *   deno task check-content
 */
import { loadContent } from "../src/content/load.ts";

const { npcs, quests, regions, locations, items, recipes, issues } =
  await loadContent();

if (issues.length > 0) {
  console.error("Content validation failed:");
  for (const issue of issues) {
    console.error(`  ${issue.file}: ${issue.message}`);
  }
  Deno.exit(1);
}

console.log(
  `Content OK: ${npcs.length} NPCs, ${quests.length} quests, ${regions.length} regions, ` +
    `${locations.length} sublocations, ` +
    `${items.length} items, ${recipes.length} recipes.`,
);
