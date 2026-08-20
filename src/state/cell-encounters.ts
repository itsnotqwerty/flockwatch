import type { CellEncounterState } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (cellId: string) => ["cell_encounters", cellId];

export async function getCellEncounter(
  cellId: string,
  s?: Store,
): Promise<CellEncounterState | null> {
  return (s ?? await openStore()).get<CellEncounterState>(key(cellId));
}

export async function saveCellEncounter(
  state: CellEncounterState,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).set(key(state.cellId), state);
}

export async function clearCellEncounter(
  cellId: string,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).delete(key(cellId));
}
