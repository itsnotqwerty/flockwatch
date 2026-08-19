import type { Player } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["players", id];

export function defaultPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
  };
}

export async function getPlayer(id: string, s?: Store): Promise<Player | null> {
  const raw = await (s ?? await openStore()).get<Player>(key(id));
  // Backfill fields added after early saves.
  return raw
    ? { ...raw, flags: raw.flags ?? [], intel: raw.intel ?? {}, restricted: raw.restricted ?? [] }
    : null;
}

/** Get a player, creating a default record on first sight. */
export async function ensurePlayer(id: string, name: string, s?: Store): Promise<Player> {
  const st = s ?? await openStore();
  return (await st.get<Player>(key(id))) ?? defaultPlayer(id, name);
}

export async function savePlayer(player: Player, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(player.id), player);
}
