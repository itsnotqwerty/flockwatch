import type { Account, Player, PlayerSession } from "../types.ts";
import {
  defaultPlayer,
  getPlayer,
  listPlayers,
  savePlayer,
} from "./players.ts";
import { openStore, type Store } from "./store.ts";

export const SESSION_COOKIE = "flockwatch_session";
export const MAX_CHARACTER_NAME_LENGTH = 24;

const accountKey = (id: string) => ["accounts", id];
const sessionKey = (token: string) => ["sessions", token];

export function normalizeCharacterName(input: string): string | null {
  const name = input.replaceAll(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > MAX_CHARACTER_NAME_LENGTH) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u.test(name) ? name : null;
}

export interface AccountCreationResult {
  ok: boolean;
  reason: string | null;
  account: Account | null;
  session: PlayerSession | null;
  player: Player | null;
}

export async function createCharacterAccount(
  requestedName: string,
  s?: Store,
): Promise<AccountCreationResult> {
  const store = s ?? await openStore();
  const name = normalizeCharacterName(requestedName);
  if (!name) {
    return {
      ok: false,
      reason:
        `Character names must contain 2–${MAX_CHARACTER_NAME_LENGTH} letters, numbers, spaces, apostrophes, hyphens, or underscores.`,
      account: null,
      session: null,
      player: null,
    };
  }
  const duplicate = (await listPlayers(store)).some((player) =>
    player.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
  );
  if (duplicate) {
    return {
      ok: false,
      reason: "That character name is already on file.",
      account: null,
      session: null,
      player: null,
    };
  }
  const now = new Date().toISOString();
  const account: Account = {
    id: `acct_${crypto.randomUUID()}`,
    playerId: `player_${crypto.randomUUID()}`,
    createdAt: now,
  };
  const session: PlayerSession = {
    token: crypto.randomUUID(),
    accountId: account.id,
    createdAt: now,
  };
  const player = defaultPlayer(account.playerId, name);
  await store.set(accountKey(account.id), account);
  await store.set(sessionKey(session.token), session);
  await savePlayer(player, store);
  return { ok: true, reason: null, account, session, player };
}

export async function getPlayerForSession(
  token: string,
  s?: Store,
): Promise<Player | null> {
  if (!token) return null;
  const store = s ?? await openStore();
  const session = await store.get<PlayerSession>(sessionKey(token));
  if (!session) return null;
  const account = await store.get<Account>(accountKey(session.accountId));
  return account ? getPlayer(account.playerId, store) : null;
}

export async function deleteSession(token: string, s?: Store): Promise<void> {
  if (!token) return;
  await (s ?? await openStore()).delete(sessionKey(token));
}

export function sessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  for (const segment of (cookieHeader ?? "").split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === SESSION_COOKIE) {
      return decodeURIComponent(rawValue.join("="));
    }
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${
    encodeURIComponent(token)
  }; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
