/**
 * JSON content validation (design §4). Checks structural shape and
 * cross-references for NPC and quest content files before merge/load.
 */
import type { CraftingRecipe, Item, Npc, Quest, Region } from "../types.ts";

export interface ContentIssue {
  file: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function validateNpcs(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) return [{ file, message: "root must be an array of NPCs" }];

  const seen = new Set<string>();
  for (const raw of data) {
    const at = (field: string) => `${(raw as Npc).id ?? "?"}: ${field}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "NPC entry must be an object" });
      continue;
    }
    for (const f of ["id", "name", "role", "region", "art", "start"]) {
      if (!requireString(raw[f])) issues.push({ file, message: at(`missing ${f}`) });
    }
    if (seen.has(raw.id as string)) {
      issues.push({ file, message: at("duplicate npc id") });
    }
    seen.add(raw.id as string);
    if (!/^[a-z0-9_-]+$/.test(String(raw.art))) {
      issues.push({ file, message: at("art must be a safe file name") });
    }
    if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
      issues.push({ file, message: at("nodes must be a non-empty array") });
      continue;
    }

    const nodeIds = new Set(raw.nodes.map((n) => (n as DialogueNodeLike).id));
    if (!nodeIds.has(raw.start as string)) {
      issues.push({ file, message: at(`start node "${String(raw.start)}" not found`) });
    }
    for (const node of raw.nodes as DialogueNodeLike[]) {
      if (!requireString(node?.id) || !requireString(node?.line)) {
        issues.push({ file, message: at("node missing id or line") });
        continue;
      }
      if (!Array.isArray(node.options)) {
        issues.push({ file, message: `${node.id}: options must be an array` });
        continue;
      }
      for (const opt of node.options) {
        if (!requireString(opt?.id) || !requireString(opt?.label) || !requireString(opt?.response)) {
          issues.push({ file, message: `${node.id}: option missing id/label/response` });
          continue;
        }
        const next = opt.next;
        if (next !== null && next !== "reset" && !nodeIds.has(next as string)) {
          issues.push({ file, message: `${node.id}.${opt.id}: next "${String(next)}" not found` });
        }
      }
    }
  }
  return issues;
}

interface DialogueNodeLike {
  id: string;
  line: string;
  options: Array<{
    id: string;
    label: string;
    response: string;
    next: string | null;
    grantsQuest?: string;
    advancesQuest?: string;
  }>;
}

export function validateQuests(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) return [{ file, message: "root must be an array of quests" }];

  const seen = new Set<string>();
  for (const raw of data as Quest[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "quest entry must be an object" });
      continue;
    }
    if (!requireString(raw.id) || !requireString(raw.title)) {
      issues.push({ file, message: at("missing id or title") });
    }
    if (seen.has(raw.id)) issues.push({ file, message: at("duplicate quest id") });
    seen.add(raw.id);
    if (!isObject(raw.trigger) || !requireString(raw.trigger.npc) || !requireString(raw.trigger.dialogueOption)) {
      issues.push({ file, message: at("trigger must name npc and dialogueOption") });
    }
    if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
      issues.push({ file, message: at("stages must be a non-empty array") });
    }
    if (!isObject(raw.rewards) || typeof raw.rewards.currency !== "number" || !Array.isArray(raw.rewards.items)) {
      issues.push({ file, message: at("rewards must have currency (number) and items (array)") });
    }
  }
  return issues;
}

export function validateRegions(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) return [{ file, message: "root must be an array of regions" }];
  const seen = new Set<string>();
  for (const raw of data as Region[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "region entry must be an object" });
      continue;
    }
    if (!requireString(raw.id) || !requireString(raw.name)) {
      issues.push({ file, message: at("missing id or name") });
    }
    if (seen.has(raw.id)) issues.push({ file, message: at("duplicate region id") });
    seen.add(raw.id);
    if (!Array.isArray(raw.locations)) issues.push({ file, message: at("locations must be an array") });
    if (!isObject(raw.stats)) {
      issues.push({ file, message: at("stats must be an object") });
    } else {
      for (const k of ["coverage", "unrest", "prosperity", "flockPresence"]) {
        const v = (raw.stats as unknown as Record<string, unknown>)[k];
        if (typeof v !== "number" || v < 0 || v > 1) {
          issues.push({ file, message: at(`stats.${k} must be 0.0–1.0`) });
        }
      }
    }
    if (!isObject(raw.economyProfile) || typeof raw.economyProfile.wageMultiplier !== "number") {
      issues.push({ file, message: at("economyProfile requires a numeric wageMultiplier") });
    }
  }
  return issues;
}

const RARITIES = new Set(["common", "uncommon", "rare", "contraband"]);
const COMPONENTS = new Set(["lens", "housing", "wiring", "circuit_board"]);

export function validateItems(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) return [{ file, message: "root must be an array of items" }];
  const seen = new Set<string>();
  for (const raw of data as Item[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "item entry must be an object" });
      continue;
    }
    if (!requireString(raw.id) || !requireString(raw.name) || !requireString(raw.description)) {
      issues.push({ file, message: at("missing id, name, or description") });
    }
    if (seen.has(raw.id)) issues.push({ file, message: at("duplicate item id") });
    seen.add(raw.id);
    if (!RARITIES.has(raw.rarity)) issues.push({ file, message: at(`bad rarity "${String(raw.rarity)}"`) });
    if (typeof raw.tradeable !== "boolean") issues.push({ file, message: at("tradeable must be boolean") });
  }
  return issues;
}

export function validateRecipes(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) return [{ file, message: "root must be an array of recipes" }];
  const seen = new Set<string>();
  for (const raw of data as CraftingRecipe[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "recipe entry must be an object" });
      continue;
    }
    if (!requireString(raw.id) || !requireString(raw.result)) {
      issues.push({ file, message: at("missing id or result") });
    }
    if (seen.has(raw.id)) issues.push({ file, message: at("duplicate recipe id") });
    seen.add(raw.id);
    if (!isObject(raw.components) || Object.keys(raw.components).length === 0) {
      issues.push({ file, message: at("components must be a non-empty object") });
    } else {
      for (const [comp, n] of Object.entries(raw.components)) {
        if (!COMPONENTS.has(comp)) issues.push({ file, message: at(`unknown component "${comp}"`) });
        if (typeof n !== "number" || n <= 0) issues.push({ file, message: at(`component "${comp}" must be a positive count`) });
      }
    }
    if (typeof raw.workbench !== "boolean") issues.push({ file, message: at("workbench must be boolean") });
  }
  return issues;
}

/** Cross-file checks: quest triggers and advance references must resolve. */
export function validateCrossReferences(
  npcs: Npc[],
  quests: Quest[],
  file: string,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const questIds = new Set(quests.map((q) => q.id));

  for (const quest of quests) {
    const npc = npcs.find((n) => n.id === quest.trigger.npc);
    if (!npc) {
      issues.push({ file, message: `${quest.id}: trigger npc "${quest.trigger.npc}" not found` });
      continue;
    }
    const option = npc.nodes.flatMap((n) => n.options)
      .find((o) => o.id === quest.trigger.dialogueOption);
    if (!option) {
      issues.push({
        file,
        message: `${quest.id}: trigger option "${quest.trigger.dialogueOption}" not found on ${npc.id}`,
      });
    } else if (option.grantsQuest !== quest.id) {
      issues.push({
        file,
        message: `${quest.id}: trigger option does not grantsQuest this quest`,
      });
    }
  }

  for (const npc of npcs) {
    for (const node of npc.nodes) {
      for (const opt of node.options) {
        for (const ref of [opt.grantsQuest, opt.advancesQuest]) {
          if (ref && !questIds.has(ref)) {
            issues.push({ file, message: `${npc.id}.${node.id}.${opt.id}: unknown quest "${ref}"` });
          }
        }
      }
    }
  }
  return issues;
}
