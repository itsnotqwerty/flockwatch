import type { Player } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["players", id];

const LEGACY_REGIONS: Record<string, string> = {
  rust_belt: "cleveland",
  gulf_coast: "new_orleans",
  pacific_northwest: "seattle",
  new_york: "new_york_city",
};

const DEFAULT_LOCATIONS: Record<string, string> = {
  cleveland: "cuyahoga_rolling_mill",
  atlanta: "sector_4_motor_pool",
  new_orleans: "storm_drain_outfall_9",
  seattle: "municipal_visitor_center",
  silicon_valley: "office_of_zoning_compliance",
  new_york_city: "subway_platform_b",
  los_angeles: "la_union_signal_depot",
  denver: "den_union_weather_hall",
  albuquerque: "abq_rail_yards",
  chicago: "chi_lower_wacker_dispatch",
  boston: "bos_harbor_archive",
  miami: "mia_little_havana_dispatch",
};

export const CLEVELAND_MEMORIAL_PARK = "memorial_park_service_tunnel";

/**
 * Detect an untouched character produced by the pre-opening default. These
 * records have no opening marker and still carry the original mill spawn.
 * Restricting this migration to exact starter state avoids replaying the
 * opening for established legacy characters.
 */
function needsOpeningMigration(raw: Player): boolean {
  return raw.openingStep === undefined && raw.region === "cleveland" &&
    (raw.location === undefined || raw.location === "cuyahoga_rolling_mill") &&
    raw.currency === 25 && (raw.inventory?.length ?? 0) === 0 &&
    (raw.quests?.length ?? 0) === 0 && raw.suspicion === 0 &&
    Object.values(raw.scrap ?? {}).every((amount) => !amount) &&
    (raw.completedLocationActions?.length ?? 0) === 0;
}

function normalizePlayer(raw: Player): Player {
  const region = LEGACY_REGIONS[raw.region] ?? raw.region;
  const migrateOpening = needsOpeningMigration(raw);
  const heldQuests = raw.quests ?? [];
  const needsDiscrepancyHandoff =
    heldQuests.some((quest) =>
      quest.questId === "q_provisional_existence" &&
      quest.status === "completed"
    ) && !heldQuests.some((quest) => quest.questId === "q_the_discrepancy");
  return {
    ...raw,
    region,
    location: migrateOpening
      ? CLEVELAND_MEMORIAL_PARK
      : raw.location ?? DEFAULT_LOCATIONS[region] ?? "cuyahoga_rolling_mill",
    openingStep: raw.openingStep ?? (migrateOpening ? "letter" : "complete"),
    quests: needsDiscrepancyHandoff
      ? [...heldQuests, {
        questId: "q_the_discrepancy",
        status: "accepted",
        stageIndex: 0,
      }]
      : heldQuests,
    questNotifications: raw.questNotifications ?? [],
    flags: raw.flags ?? [],
    intel: raw.intel ?? {},
    restricted: raw.restricted ?? [],
    completedLocationActions: raw.completedLocationActions ?? [],
    locationActionRefreshAt: raw.locationActionRefreshAt ?? {},
    trustedPlayerIds: raw.trustedPlayerIds ?? [],
    lastSeenAt: raw.lastSeenAt ?? new Date().toISOString(),
  };
}

export function defaultPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: CLEVELAND_MEMORIAL_PARK,
    quests: [],
    questNotifications: [],
    openingStep: "letter",
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: new Date().toISOString(),
  };
}

/** Advance the mandatory new-character opening by exactly one panel. */
export function advanceOpening(player: Player): Player {
  if (player.openingStep === "letter") {
    return { ...player, openingStep: "outside" };
  }
  if (player.openingStep === "outside") {
    return {
      ...player,
      openingStep: "complete",
      region: "cleveland",
      location: CLEVELAND_MEMORIAL_PARK,
    };
  }
  return player;
}

export async function getPlayer(id: string, s?: Store): Promise<Player | null> {
  const raw = await (s ?? await openStore()).get<Player>(key(id));
  // Backfill fields added after early saves.
  return raw ? normalizePlayer(raw) : null;
}

/** Get a player, creating a default record on first sight. */
export async function ensurePlayer(
  id: string,
  name: string,
  s?: Store,
): Promise<Player> {
  const st = s ?? await openStore();
  const raw = await st.get<Player>(key(id));
  return raw ? normalizePlayer(raw) : defaultPlayer(id, name);
}

export async function savePlayer(player: Player, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(player.id), player);
}

export async function listPlayers(s?: Store): Promise<Player[]> {
  const entries = await (s ?? await openStore()).list<Player>(["players"]);
  return entries.map((entry) => normalizePlayer(entry.value));
}

export const PRESENCE_WINDOW_MS = 15 * 60 * 1000;

export async function touchPlayer(
  player: Player,
  now = Date.now(),
  s?: Store,
): Promise<Player> {
  const updated = { ...player, lastSeenAt: new Date(now).toISOString() };
  await savePlayer(updated, s);
  return updated;
}

export async function listPlayersAtLocation(
  region: string,
  location: string,
  now = Date.now(),
  s?: Store,
): Promise<Player[]> {
  const cutoff = now - PRESENCE_WINDOW_MS;
  return (await listPlayers(s)).filter((player) =>
    player.region === region && player.location === location &&
    Date.parse(player.lastSeenAt) >= cutoff
  );
}
