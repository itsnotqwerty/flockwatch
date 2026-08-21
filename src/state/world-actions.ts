import { openStore, type Store } from "./store.ts";

export const WORLD_ACTION_LOCK_MS = 30_000;
const key = (kind: string, id: string) => ["world_action_locks", kind, id];

/** Short lease used to serialize mutations of shared world entities. */
export async function claimWorldAction(
  kind: string,
  id: string,
  s?: Store,
): Promise<boolean> {
  return (s ?? await openStore()).setIfAbsent(
    key(kind, id),
    new Date().toISOString(),
    WORLD_ACTION_LOCK_MS,
  );
}

/** Release a lease when validation fails and no mutation was committed. */
export async function releaseWorldAction(
  kind: string,
  id: string,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).delete(key(kind, id));
}
