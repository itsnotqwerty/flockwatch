/**
 * Shared types mirroring the data formats in docs/spec.md §4.
 */

// ── §4.1 Quest ──────────────────────────────────────────────────────────────

export type QuestStatus = "accepted" | "completed" | "failed";

export interface QuestTrigger {
  npc: string;
  dialogueOption: string;
}

export interface QuestStage {
  id: string;
  objective: string;
}

export interface QuestRewards {
  currency: number;
  items: string[];
}

/** Quest definition. Hidden quests are never listed until triggered. */
export interface Quest {
  id: string;
  title: string;
  hidden: boolean;
  trigger: QuestTrigger;
  stages: QuestStage[];
  rewards: QuestRewards;
}

/** Per-player quest instance. */
export interface PlayerQuest {
  questId: string;
  status: QuestStatus;
  stageIndex: number;
}

// ── §4.2 Item ───────────────────────────────────────────────────────────────

export type Rarity = "common" | "uncommon" | "rare" | "contraband";

export interface Item {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  tradeable: boolean;
}

// ── §4.3 Market Listing ─────────────────────────────────────────────────────

export interface MarketListing {
  id: string;
  sellerId: string;
  itemId: string;
  price: number;
  listedAt: string; // ISO 8601
}

// ── §4.4 Camera ─────────────────────────────────────────────────────────────

export type CameraStatus = "contracted" | "active" | "dismantled";

export type ScrapComponent = "lens" | "housing" | "wiring" | "circuit_board";

export interface Camera {
  id: string;
  region: string;
  status: CameraStatus;
  installedBy: string | null;
  wageValue: number;
  scrapYield: ScrapComponent[];
}

// ── §4.5 Crafting Recipe ────────────────────────────────────────────────────

export interface CraftingRecipe {
  id: string;
  result: string; // item id
  components: Partial<Record<ScrapComponent, number>>;
  workbench: boolean;
}

// ── §4.6 Region ─────────────────────────────────────────────────────────────

export interface RegionStats {
  /** Normalized 0.0–1.0, recomputed on the scheduled tick. */
  coverage: number;
  unrest: number;
  prosperity: number;
  flockPresence: number;
  populationMood: string;
}

export interface EconomyProfile {
  consumes: string[];
  produces: string[];
  wageMultiplier: number;
}

export interface Region {
  id: string;
  name: string;
  locations: string[];
  stats: RegionStats;
  economyProfile: EconomyProfile;
}

// ── Dialogue (spec §3.1–3.2) ────────────────────────────────────────────────

/** A dialogue option; selecting it may secretly assign a quest. */
export interface DialogueOption {
  /** Stable id; matches QuestTrigger.dialogueOption when it grants a quest. */
  id: string;
  label: string;
  /** NPC response rendered through grillsay. */
  response: string;
  /**
   * Node to continue to, `null` to end the conversation, or the sentinel
   * `"reset"` to offer a generic "start over" control back to the first node.
   */
  next: string | null;
  /** Quest secretly assigned when this option is selected. */
  grantsQuest?: string;
  /**
   * Gate for grantsQuest options: the named quest must already be completed
   * before this option is visible (quest chains / follow-up assignments).
   */
  requiresQuestCompleted?: string;
  /**
   * Advance the named accepted quest by one stage when selected. On the final
   * stage the quest is turned in: it completes and pays out rewards.
   */
  advancesQuest?: string;
  /**
   * Optional stage gate for advancesQuest options: the option is only visible
   * while the player's quest is at one of these stage indexes. Without it the
   * option is available at any accepted stage.
   */
  atStages?: number[];
}

export interface DialogueNode {
  id: string;
  /** NPC line rendered through grillsay on entering this node. */
  line: string;
  options: DialogueOption[];
}

/** An NPC with a dialogue tree and grillsay art file. */
export interface Npc {
  id: string;
  name: string;
  role: string;
  region: string;
  /** Art file name under tools/grillsay/art/ */
  art: string;
  /** Entry node id. */
  start: string;
  nodes: DialogueNode[];
}

// ── Player ──────────────────────────────────────────────────────────────────

/**
 * Cooldowns for camera activities (install/dismantle). Maps an activity key to
 * the epoch-ms time when the player may next perform it. Absent/zero = ready.
 */
export type ActivityTimers = Partial<Record<"install" | "dismantle", number>>;

export interface Player {
  id: string;
  name: string;
  currency: number;
  inventory: string[]; // item ids
  scrap: Partial<Record<ScrapComponent, number>>;
  suspicion: number;
  region: string;
  quests: PlayerQuest[];
  /** Activity-based refresh timers for camera work. */
  timers?: ActivityTimers;
}
