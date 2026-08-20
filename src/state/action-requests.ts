import { openStore, type Store } from "./store.ts";

const REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const REQUEST_TTL_MS = 24 * 60 * 60_000;
const key = (playerId: string, requestId: string) => [
  "action_requests",
  playerId,
  requestId,
];

/**
 * Claims a browser-generated action id once for a player. Replayed POSTs are
 * rejected before their handler can mutate game state. Claims are atomic in
 * Deno KV, so rapid double-clicks cannot race each other, and expire after a
 * day to keep storage bounded.
 * Missing ids remain accepted for forms opened before this feature deployed.
 */
export async function claimActionRequest(
  playerId: string,
  requestId: string | undefined,
  s?: Store,
): Promise<boolean> {
  if (!requestId) return true;
  if (!REQUEST_ID_PATTERN.test(requestId)) return false;

  const store = s ?? await openStore();
  return store.setIfAbsent(
    key(playerId, requestId),
    new Date().toISOString(),
    REQUEST_TTL_MS,
  );
}
