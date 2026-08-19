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
  /** Region whose market board carries this listing (spec §3.0 local economies). */
  regionId: string;
  /** Asking price before any Ministry of Valuation decree modifiers. */
  price: number;
  listedAt: string; // ISO 8601
}

/** A recorded sale, kept per item for price history (spec §3.3). */
export interface PricePoint {
  itemId: string;
  /** Price actually paid (after decree modifiers). */
  price: number;
  soldAt: string; // ISO 8601
}

/**
 * A Ministry of Valuation decree (spec §3.3): a live-ops price modifier
 * applied to every market transaction while active.
 */
export interface Decree {
  id: string;
  title: string;
  proclamation: string;
  /** Price multiplier; 1.2 means prices rise 20%. */
  priceMultiplier: number;
  /** "national" applies everywhere; "regional" applies to `region` only. */
  scope: "national" | "regional";
  /** Required when scope is "regional". */
  region: string | null;
  issuedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}

// ── §4.7 Espionage ─────────────────────────────────────────────────────────

export type EspionageActionType = "tail" | "intercept" | "gather_intel";

/** Persistent consequence of a blown espionage operation (spec §3.5). */
export interface EspionageFlag {
  id: string;
  region: string;
  action: EspionageActionType;
  reason: string;
  flaggedAt: string; // ISO 8601
}

// ── §4.8 Encounters ────────────────────────────────────────────────────────

export interface EncounterMove {
  id: string;
  label: string;
  /** Flat damage dealt to the enemy. */
  damage: number;
  /** Flat damage suffered by the player. */
  selfDamage: number;
  /** Suspicion delta applied on use. */
  suspicion: number;
  /** Intel gained on use (espionage encounters). */
  intel?: number;
  /** Currency spent on use (e.g., a bribe). */
  cost?: number;
  /** Ends the encounter immediately in escape. */
  flees?: boolean;
}

export type EncounterKind = "patrol" | "boss";

export interface Encounter {
  id: string;
  name: string;
  art: string;
  kind: EncounterKind;
  /** Regions where this encounter can spawn. */
  regions: string[];
  /** Minimum regional Flock presence required for a patrol spawn. */
  minFlockPresence: number;
  maxHp: number;
  moves: EncounterMove[];
  victoryLine: string;
  defeatLine: string;
  /** Currency paid on victory. */
  payout: number;
  /** Items granted on victory. */
  drops: string[];
  /** Suspicion cleared on victory. */
  clearsSuspicion?: number;
  /** Bosses only: flavored phase-change announcements at these hp fractions. */
  phases?: Array<{ at: number; line: string }>;
}

export type EncounterStatus = "ongoing" | "victory" | "defeat" | "fled";

/** A live encounter instance for one player. */
export interface EncounterState {
  encounterId: string;
  playerId: string;
  region: string;
  enemyHp: number;
  status: EncounterStatus;
  /** Boss phase index already announced. */
  phaseIndex: number;
  log: string[];
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
  /**
   * Region-wide camera work cooldowns (§3.6), shared by all players: maps an
   * activity key to the epoch-ms time when anyone may next perform it here.
   */
  cameraCooldowns?: CameraCooldowns;
}

/** Cooldowns for camera activities, enforced per region across all players. */
export type CameraCooldowns = Partial<Record<"install" | "dismantle", number>>;

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

export interface Player {
  id: string;
  name: string;
  currency: number;
  inventory: string[]; // item ids
  scrap: Partial<Record<ScrapComponent, number>>;
  suspicion: number;
  region: string;
  quests: PlayerQuest[];
  /** Persistent espionage flags from blown operations (spec §3.5). */
  flags: EspionageFlag[];
  /** Dossier intel gathered through espionage, per region. */
  intel: Partial<Record<string, number>>;
  /** Regions where patrol encounters are suppressed (restricted — player is known). */
  restricted: string[];
}
