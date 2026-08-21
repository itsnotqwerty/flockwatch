/**
 * JSON content validation (design §4). Checks structural shape and
 * cross-references for NPC and quest content files before merge/load.
 */
import type {
  CraftingRecipe,
  Decree,
  Encounter,
  Item,
  LocationInteraction,
  Npc,
  Quest,
  Region,
  Sublocation,
} from "../types.ts";
import { CRAFTING_MATERIALS } from "../types.ts";

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

const COMPONENTS = new Set<string>(CRAFTING_MATERIALS);

function validateMaterialMap(
  value: unknown,
  label: string,
  file: string,
  issues: ContentIssue[],
  required: boolean,
): void {
  if (!isObject(value) || (required && Object.keys(value).length === 0)) {
    issues.push({ file, message: `${label} must be a non-empty object` });
    return;
  }
  for (const [material, amount] of Object.entries(value)) {
    if (!COMPONENTS.has(material)) {
      issues.push({
        file,
        message: `${label}: unknown material "${material}"`,
      });
    }
    if (
      typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0
    ) {
      issues.push({
        file,
        message: `${label}: material "${material}" must be a positive integer`,
      });
    }
  }
}

export function validateNpcs(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of NPCs" }];
  }

  const seen = new Set<string>();
  for (const raw of data) {
    const at = (field: string) => `${(raw as Npc).id ?? "?"}: ${field}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "NPC entry must be an object" });
      continue;
    }
    for (const f of ["id", "name", "role", "region", "art", "start"]) {
      if (!requireString(raw[f])) {
        issues.push({ file, message: at(`missing ${f}`) });
      }
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
      issues.push({
        file,
        message: at(`start node "${String(raw.start)}" not found`),
      });
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
        if (
          !requireString(opt?.id) || !requireString(opt?.label) ||
          !requireString(opt?.response)
        ) {
          issues.push({
            file,
            message: `${node.id}: option missing id/label/response`,
          });
          continue;
        }
        const next = opt.next;
        if (next !== null && next !== "reset" && !nodeIds.has(next as string)) {
          issues.push({
            file,
            message: `${node.id}.${opt.id}: next "${String(next)}" not found`,
          });
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
    requiresQuestCompleted?: string;
    atStages?: number[];
    setsIdentityResolution?: string;
  }>;
}

const QUEST_EVENTS = new Set([
  "camera.install",
  "camera.dismantle",
  "craft",
  "market.trade",
  "espionage.success",
  "encounter.victory",
  "boss.victory",
  "cell.operation",
]);

export function validateQuests(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of quests" }];
  }

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
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate quest id") });
    }
    seen.add(raw.id);
    if (
      !isObject(raw.trigger) || !requireString(raw.trigger.npc) ||
      !requireString(raw.trigger.dialogueOption)
    ) {
      issues.push({
        file,
        message: at("trigger must name npc and dialogueOption"),
      });
    }
    if (!Array.isArray(raw.stages) || raw.stages.length === 0) {
      issues.push({ file, message: at("stages must be a non-empty array") });
    } else {
      for (const [index, stage] of raw.stages.entries()) {
        if (!requireString(stage.id) || !requireString(stage.objective)) {
          issues.push({
            file,
            message: at(`stage ${index} requires id and objective`),
          });
        }
        if (
          stage.requirement &&
          (!isObject(stage.requirement) ||
            !QUEST_EVENTS.has(String(stage.requirement.event)))
        ) {
          issues.push({
            file,
            message: at(`stage ${index} has an invalid requirement event`),
          });
        }
      }
    }
    if (
      !isObject(raw.rewards) || typeof raw.rewards.currency !== "number" ||
      !Array.isArray(raw.rewards.items)
    ) {
      issues.push({
        file,
        message: at("rewards must have currency (number) and items (array)"),
      });
    } else {
      validateMaterialMap(
        raw.rewards.materials,
        at("rewards.materials"),
        file,
        issues,
        true,
      );
    }
  }
  return issues;
}

export function validateRegions(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of regions" }];
  }
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
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate region id") });
    }
    seen.add(raw.id);
    if (!Array.isArray(raw.locations)) {
      issues.push({ file, message: at("locations must be an array") });
    }
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
    if (
      !isObject(raw.economyProfile) ||
      typeof raw.economyProfile.wageMultiplier !== "number"
    ) {
      issues.push({
        file,
        message: at("economyProfile requires a numeric wageMultiplier"),
      });
    }
  }
  return issues;
}

const LOCATION_INTERACTION_KINDS = new Set([
  "npcs",
  "market",
  "workbench",
  "cameras",
  "espionage",
  "encounter",
  "message_board",
  "activity",
]);

export function validateLocations(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of sublocations" }];
  }
  const seen = new Set<string>();
  for (const raw of data as Sublocation[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "sublocation entry must be an object" });
      continue;
    }
    for (const field of ["id", "regionId", "name", "description"] as const) {
      if (!requireString(raw[field])) {
        issues.push({ file, message: at(`missing ${field}`) });
      }
    }
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate sublocation id") });
    }
    seen.add(raw.id);
    if (
      !Array.isArray(raw.interactions) || raw.interactions.length < 5 ||
      raw.interactions.length > 6
    ) {
      issues.push({
        file,
        message: at("interactions must contain 5–6 entries"),
      });
      continue;
    }
    const interactionIds = new Set<string>();
    for (const interaction of raw.interactions as LocationInteraction[]) {
      if (
        !requireString(interaction?.id) || !requireString(interaction?.label) ||
        !requireString(interaction?.description)
      ) {
        issues.push({
          file,
          message: at("interaction missing id, label, or description"),
        });
        continue;
      }
      if (interactionIds.has(interaction.id)) {
        issues.push({
          file,
          message: at(`duplicate interaction id "${interaction.id}"`),
        });
      }
      interactionIds.add(interaction.id);
      if (!LOCATION_INTERACTION_KINDS.has(interaction.kind)) {
        issues.push({
          file,
          message: at(`unknown interaction kind "${String(interaction.kind)}"`),
        });
      }
      if (
        interaction.kind === "npcs" &&
        (!Array.isArray(interaction.npcIds) || interaction.npcIds.length === 0)
      ) {
        issues.push({
          file,
          message: at(`${interaction.id}: npcs interaction requires npcIds`),
        });
      }
      if (
        interaction.kind === "activity" && !requireString(interaction.result)
      ) {
        issues.push({
          file,
          message: at(`${interaction.id}: activity requires result copy`),
        });
      }
      if (interaction.effect?.scrap !== undefined) {
        validateMaterialMap(
          interaction.effect.scrap,
          at(`${interaction.id}.effect.scrap`),
          file,
          issues,
          true,
        );
      }
    }
  }
  return issues;
}

const RARITIES = new Set(["common", "uncommon", "rare", "contraband"]);
export function validateItems(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of items" }];
  }
  const seen = new Set<string>();
  for (const raw of data as Item[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "item entry must be an object" });
      continue;
    }
    if (
      !requireString(raw.id) || !requireString(raw.name) ||
      !requireString(raw.description)
    ) {
      issues.push({ file, message: at("missing id, name, or description") });
    }
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate item id") });
    }
    seen.add(raw.id);
    if (!RARITIES.has(raw.rarity)) {
      issues.push({ file, message: at(`bad rarity "${String(raw.rarity)}"`) });
    }
    if (typeof raw.tradeable !== "boolean") {
      issues.push({ file, message: at("tradeable must be boolean") });
    }
  }
  return issues;
}

export function validateRecipes(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of recipes" }];
  }
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
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate recipe id") });
    }
    seen.add(raw.id);
    if (!isObject(raw.components) || Object.keys(raw.components).length === 0) {
      issues.push({
        file,
        message: at("components must be a non-empty object"),
      });
    } else {
      for (const [comp, n] of Object.entries(raw.components)) {
        if (!COMPONENTS.has(comp)) {
          issues.push({ file, message: at(`unknown component "${comp}"`) });
        }
        if (typeof n !== "number" || n <= 0) {
          issues.push({
            file,
            message: at(`component "${comp}" must be a positive count`),
          });
        }
      }
    }
    if (typeof raw.workbench !== "boolean") {
      issues.push({ file, message: at("workbench must be boolean") });
    }
  }
  return issues;
}

export function validateDecrees(data: unknown, file: string): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of decrees" }];
  }
  const seen = new Set<string>();
  for (const raw of data as Decree[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "decree entry must be an object" });
      continue;
    }
    for (const f of ["id", "title", "proclamation", "issuedAt", "expiresAt"]) {
      if (!requireString(raw[f as keyof Decree])) {
        issues.push({ file, message: at(`missing ${f}`) });
      }
    }
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate decree id") });
    }
    seen.add(raw.id);
    if (typeof raw.priceMultiplier !== "number" || raw.priceMultiplier <= 0) {
      issues.push({
        file,
        message: at("priceMultiplier must be a positive number"),
      });
    }
    if (raw.scope !== "national" && raw.scope !== "regional") {
      issues.push({ file, message: at(`bad scope "${String(raw.scope)}"`) });
    }
    if (raw.scope === "regional" && !requireString(raw.region)) {
      issues.push({ file, message: at("regional decree must name a region") });
    }
    if (
      isObject(raw) && Number.isFinite(Date.parse(raw.expiresAt)) &&
      Number.isFinite(Date.parse(raw.issuedAt))
    ) {
      if (Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)) {
        issues.push({ file, message: at("expiresAt must be after issuedAt") });
      }
    }
  }
  return issues;
}

const ENCOUNTER_KINDS = new Set(["patrol", "boss"]);

export function validateEncounters(
  data: unknown,
  file: string,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  if (!Array.isArray(data)) {
    return [{ file, message: "root must be an array of encounters" }];
  }
  const seen = new Set<string>();
  for (const raw of data as Encounter[]) {
    const at = (m: string) => `${raw?.id ?? "?"}: ${m}`;
    if (!isObject(raw)) {
      issues.push({ file, message: "encounter entry must be an object" });
      continue;
    }
    for (const f of ["id", "name", "art", "victoryLine", "defeatLine"]) {
      if (!requireString(raw[f as keyof Encounter])) {
        issues.push({ file, message: at(`missing ${f}`) });
      }
    }
    if (seen.has(raw.id)) {
      issues.push({ file, message: at("duplicate encounter id") });
    }
    seen.add(raw.id);
    if (!ENCOUNTER_KINDS.has(raw.kind)) {
      issues.push({ file, message: at(`bad kind "${String(raw.kind)}"`) });
    }
    if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
      issues.push({ file, message: at("regions must be a non-empty array") });
    }
    if (
      typeof raw.minFlockPresence !== "number" || raw.minFlockPresence < 0 ||
      raw.minFlockPresence > 1
    ) {
      issues.push({ file, message: at("minFlockPresence must be 0.0–1.0") });
    }
    if (typeof raw.maxHp !== "number" || raw.maxHp <= 0) {
      issues.push({ file, message: at("maxHp must be positive") });
    }
    if (!Array.isArray(raw.moves) || raw.moves.length === 0) {
      issues.push({ file, message: at("moves must be a non-empty array") });
    } else {
      for (const m of raw.moves) {
        if (!requireString(m?.id) || !requireString(m?.label)) {
          issues.push({ file, message: at("move missing id or label") });
          continue;
        }
        for (const k of ["damage", "selfDamage", "suspicion"] as const) {
          if (typeof m[k] !== "number") {
            issues.push({
              file,
              message: at(`move ${m.id}: ${k} must be a number`),
            });
          }
        }
      }
    }
    if (!Array.isArray(raw.enemyMoves) || raw.enemyMoves.length === 0) {
      issues.push({
        file,
        message: at("enemyMoves must be a non-empty array"),
      });
    } else {
      for (const m of raw.enemyMoves) {
        if (!requireString(m?.id) || !requireString(m?.label)) {
          issues.push({ file, message: at("enemy move missing id or label") });
          continue;
        }
        for (const k of ["damage", "suspicion"] as const) {
          if (typeof m[k] !== "number") {
            issues.push({
              file,
              message: at(`enemy move ${m.id}: ${k} must be a number`),
            });
          }
        }
      }
    }
    if (typeof raw.payout !== "number" || raw.payout < 0) {
      issues.push({
        file,
        message: at("payout must be a non-negative number"),
      });
    }
    if (!Array.isArray(raw.drops)) {
      issues.push({ file, message: at("drops must be an array") });
    }
    if (
      raw.quips !== undefined &&
      (!Array.isArray(raw.quips) ||
        raw.quips.some((q) => !requireString(q)))
    ) {
      issues.push({ file, message: at("quips must be an array of strings") });
    }
    validateMaterialMap(
      raw.materialDrops,
      at("materialDrops"),
      file,
      issues,
      true,
    );
    if (
      raw.kind === "boss" &&
      (!Array.isArray(raw.phases) || raw.phases.length < 1)
    ) {
      issues.push({
        file,
        message: at("boss encounters require at least one phase"),
      });
    }
  }
  return issues;
}

/** Cross-file checks: quest triggers and advance references must resolve. */
export function validateCrossReferences(
  npcs: Npc[],
  quests: Quest[],
  regions: Region[],
  locations: Sublocation[],
  items: Item[],
  recipes: CraftingRecipe[],
  encounters: Encounter[],
  file: string,
): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const questIds = new Set(quests.map((q) => q.id));
  const duplicateIds = <T>(
    values: T[],
    id: (value: T) => string,
    kind: string,
  ) => {
    const seen = new Set<string>();
    for (const value of values) {
      const valueId = id(value);
      if (seen.has(valueId)) {
        issues.push({ file, message: `${kind}: duplicate id "${valueId}"` });
      }
      seen.add(valueId);
    }
  };
  duplicateIds(npcs, (value) => value.id, "npc");
  duplicateIds(quests, (value) => value.id, "quest");
  duplicateIds(regions, (value) => value.id, "region");
  duplicateIds(locations, (value) => value.id, "location");
  duplicateIds(items, (value) => value.id, "item");
  duplicateIds(recipes, (value) => value.id, "recipe");
  duplicateIds(encounters, (value) => value.id, "encounter");

  for (const quest of quests) {
    const npc = npcs.find((n) => n.id === quest.trigger.npc);
    if (!npc) {
      issues.push({
        file,
        message: `${quest.id}: trigger npc "${quest.trigger.npc}" not found`,
      });
      continue;
    }
    const option = npc.nodes.flatMap((n) => n.options)
      .find((o) => o.id === quest.trigger.dialogueOption);
    if (!option) {
      issues.push({
        file,
        message:
          `${quest.id}: trigger option "${quest.trigger.dialogueOption}" not found on ${npc.id}`,
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
        for (
          const ref of [
            opt.grantsQuest,
            opt.advancesQuest,
            opt.requiresQuestCompleted,
          ]
        ) {
          if (ref && !questIds.has(ref)) {
            issues.push({
              file,
              message: `${npc.id}.${node.id}.${opt.id}: unknown quest "${ref}"`,
            });
          }
        }
        if (opt.atStages !== undefined) {
          const quest = quests.find((candidate) =>
            candidate.id === opt.advancesQuest
          );
          if (!opt.advancesQuest || !quest) {
            issues.push({
              file,
              message:
                `${npc.id}.${node.id}.${opt.id}: atStages requires a valid advancesQuest`,
            });
          } else if (
            !Array.isArray(opt.atStages) || opt.atStages.length === 0 ||
            opt.atStages.some((stage) =>
              !Number.isInteger(stage) || stage < 0 ||
              stage >= quest.stages.length
            )
          ) {
            issues.push({
              file,
              message:
                `${npc.id}.${node.id}.${opt.id}: atStages must reference valid stages of "${quest.id}"`,
            });
          }
        }
      }
    }
  }

  const npcIds = new Set(npcs.map((npc) => npc.id));
  const itemIds = new Set(items.map((item) => item.id));
  const locationIds = new Set(locations.map((location) => location.id));
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  for (const quest of quests) {
    for (const [index, stage] of quest.stages.entries()) {
      if (
        stage.requirement?.region && !regionsById.has(stage.requirement.region)
      ) {
        issues.push({
          file,
          message:
            `${quest.id}: stage ${index} references unknown region "${stage.requirement.region}"`,
        });
      }
      if (
        stage.requirement?.event === "boss.victory" &&
        stage.requirement.target &&
        !encounters.some((encounter) =>
          encounter.id === stage.requirement!.target &&
          encounter.kind === "boss"
        )
      ) {
        issues.push({
          file,
          message:
            `${quest.id}: stage ${index} references unknown boss "${stage.requirement.target}"`,
        });
      }
    }
  }
  for (const npc of npcs) {
    if (!regionsById.has(npc.region)) {
      issues.push({
        file,
        message: `${npc.id}: unknown region "${npc.region}"`,
      });
    }
    const placed = locations.some((location) =>
      location.regionId === npc.region &&
      location.interactions.some((interaction) =>
        interaction.npcIds?.includes(npc.id)
      )
    );
    if (!placed) {
      issues.push({
        file,
        message: `${npc.id}: NPC is not placed in its region`,
      });
    }
  }
  for (const region of regions) {
    if (region.locations.length < 2 || region.locations.length > 3) {
      issues.push({
        file,
        message: `${region.id}: region must contain 2–3 sublocations`,
      });
    }
    for (const locationId of region.locations) {
      const location = locations.find((candidate) =>
        candidate.id === locationId
      );
      if (!location) {
        issues.push({
          file,
          message: `${region.id}: unknown sublocation "${locationId}"`,
        });
      } else if (location.regionId !== region.id) {
        issues.push({
          file,
          message:
            `${locationId}: belongs to ${location.regionId}, not ${region.id}`,
        });
      }
    }
    const boardCount = locations
      .filter((location) => location.regionId === region.id)
      .flatMap((location) => location.interactions)
      .filter((interaction) => interaction.kind === "message_board").length;
    if (boardCount !== 1) {
      issues.push({
        file,
        message:
          `${region.id}: requires exactly one regional message board; found ${boardCount}`,
      });
    }
    if (
      !encounters.some((encounter) => encounter.regions.includes(region.id))
    ) {
      issues.push({
        file,
        message: `${region.id}: no encounter content is available`,
      });
    }
    if (
      !encounters.some((encounter) =>
        encounter.kind === "boss" && encounter.regions.includes(region.id)
      )
    ) {
      issues.push({
        file,
        message: `${region.id}: no boss encounter is available`,
      });
    }
  }
  for (const location of locations) {
    if (!regionsById.has(location.regionId)) {
      issues.push({
        file,
        message: `${location.id}: unknown region "${location.regionId}"`,
      });
    }
    if (!locationIds.has(location.id)) continue;
    if (!regionsById.get(location.regionId)?.locations.includes(location.id)) {
      issues.push({
        file,
        message: `${location.id}: not listed by region "${location.regionId}"`,
      });
    }
    for (const interaction of location.interactions) {
      for (const npcId of interaction.npcIds ?? []) {
        if (!npcIds.has(npcId)) {
          issues.push({
            file,
            message: `${location.id}.${interaction.id}: unknown npc "${npcId}"`,
          });
        }
      }
    }
  }

  for (const quest of quests) {
    for (const itemId of quest.rewards.items) {
      if (!itemIds.has(itemId)) {
        issues.push({
          file,
          message: `${quest.id}: reward item "${itemId}" not found`,
        });
      }
    }
  }
  for (const encounter of encounters) {
    for (const regionId of encounter.regions) {
      if (!regionsById.has(regionId)) {
        issues.push({
          file,
          message: `${encounter.id}: unknown region "${regionId}"`,
        });
      }
    }
    for (const itemId of encounter.drops) {
      if (!itemIds.has(itemId)) {
        issues.push({
          file,
          message: `${encounter.id}: drop item "${itemId}" not found`,
        });
      }
    }
  }

  for (const quest of quests) {
    const advanceOptions = npcs.flatMap((npc) =>
      npc.nodes.flatMap((node) =>
        node.options.filter((option) => option.advancesQuest === quest.id)
      )
    );
    for (let stage = 0; stage < quest.stages.length; stage += 1) {
      if (quest.stages[stage].requirement) continue;
      if (
        !advanceOptions.some((option) =>
          option.atStages === undefined || option.atStages.includes(stage)
        )
      ) {
        issues.push({
          file,
          message:
            `${quest.id}: stage ${stage} has no reachable advance option`,
        });
      }
    }
  }

  const usedMaterials = new Set<string>();
  for (const recipe of recipes) {
    if (!itemIds.has(recipe.result)) {
      issues.push({
        file,
        message: `${recipe.id}: result item "${recipe.result}" not found`,
      });
    }
    for (const material of Object.keys(recipe.components)) {
      usedMaterials.add(material);
    }
  }
  const sourcedMaterials = new Set<string>();
  for (const quest of quests) {
    Object.keys(quest.rewards.materials).forEach((material) =>
      sourcedMaterials.add(material)
    );
  }
  for (const encounter of encounters) {
    Object.keys(encounter.materialDrops).forEach((material) =>
      sourcedMaterials.add(material)
    );
  }
  for (const location of locations) {
    for (const interaction of location.interactions) {
      Object.keys(interaction.effect?.scrap ?? {}).forEach((material) =>
        sourcedMaterials.add(material)
      );
    }
  }
  for (const material of CRAFTING_MATERIALS) {
    if (!usedMaterials.has(material)) {
      issues.push({
        file,
        message: `${material}: no recipe uses this material`,
      });
    }
    if (!sourcedMaterials.has(material)) {
      issues.push({
        file,
        message: `${material}: material has no reward source`,
      });
    }
  }
  return issues;
}
