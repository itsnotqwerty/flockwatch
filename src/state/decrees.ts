import type { Decree } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["decrees", id];

export async function saveDecree(decree: Decree, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(decree.id), decree);
}

/** All decrees on record, newest first. */
export async function listDecrees(s?: Store): Promise<Decree[]> {
  const entries = await (s ?? await openStore()).list<Decree>(["decrees"]);
  return entries
    .map((e) => e.value)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

/**
 * Decrees currently in force for a region: unexpired national decrees plus
 * unexpired regional decrees naming that region.
 */
export async function activeDecrees(
  region: string,
  now = Date.now(),
  s?: Store,
): Promise<Decree[]> {
  return (await listDecrees(s)).filter((d) => {
    if (Date.parse(d.expiresAt) <= now) return false;
    return d.scope === "national" || d.region === region;
  });
}
