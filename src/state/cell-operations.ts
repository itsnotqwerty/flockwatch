import type { CellOperationState } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (cellId: string) => ["cell_operations", cellId];

export async function getCellOperation(
  cellId: string,
  s?: Store,
): Promise<CellOperationState | null> {
  return (s ?? await openStore()).get<CellOperationState>(key(cellId));
}

export async function saveCellOperation(
  state: CellOperationState,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).set(key(state.cellId), state);
}

export async function clearCellOperation(
  cellId: string,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).delete(key(cellId));
}
