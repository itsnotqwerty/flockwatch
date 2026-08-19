import type { EncounterState } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (playerId: string) => ["encounters", playerId];

/** The player's live encounter, if any. */
export async function getEncounter(playerId: string, s?: Store): Promise<EncounterState | null> {
  return (s ?? await openStore()).get<EncounterState>(key(playerId));
}

export async function saveEncounter(state: EncounterState, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(state.playerId), state);
}

export async function clearEncounter(playerId: string, s?: Store): Promise<void> {
  await (s ?? await openStore()).delete(key(playerId));
}
