import type { Account, Player, PlayerSession } from "../types.ts";
import {
  defaultPlayer,
  getPlayer,
  listPlayers,
  savePlayer,
} from "./players.ts";
import { openStore, type Store } from "./store.ts";
import {
  authLogIn,
  authSendRecovery,
  authSignUp,
  authUpdatePassword,
  authVerifyRecovery,
  type Credential,
  credentialKey,
  tokenHash,
} from "./local-auth.ts";

export const SESSION_COOKIE = "flockwatch_session";
export const MAX_CHARACTER_NAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = 8;

const accountKey = (id: string) => ["accounts", id];
const accountByEmailKey = (email: string) => ["account_emails", email];
const sessionKey = async (
  token: string,
) => ["sessions", await tokenHash(token)];
export const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

export function normalizeCharacterName(input: string): string | null {
  const name = input.replaceAll(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > MAX_CHARACTER_NAME_LENGTH) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N} _'-]*$/u.test(name) ? name : null;
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function createSession(
  accountId: string,
  store: Store,
  authVersion?: string,
): Promise<PlayerSession> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const session: PlayerSession = {
    token,
    accountId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    authVersion,
  };
  const { token: _token, ...stored } = session;
  await store.setIfAbsent(await sessionKey(token), stored, SESSION_TTL_MS);
  return session;
}

export interface AuthResult {
  ok: boolean;
  reason: string | null;
  account: Account | null;
  session: PlayerSession | null;
  player: Player | null;
}

/** @deprecated Use AuthResult. */
export type AccountCreationResult = AuthResult;

async function findAccountByEmail(
  email: string,
  store: Store,
): Promise<Account | null> {
  const id = await store.get<string>(accountByEmailKey(email));
  return id ? store.get<Account>(accountKey(id)) : null;
}

// ── Signup ──────────────────────────────────────────────────────────────────

export async function signUp(
  emailInput: string,
  password: string,
  requestedName: string,
  s?: Store,
): Promise<AuthResult> {
  const store = s ?? await openStore();
  const fail = (reason: string): AuthResult => ({
    ok: false,
    reason,
    account: null,
    session: null,
    player: null,
  });

  const email = normalizeEmail(emailInput);
  if (!email) return fail("A valid email address is required.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(
      `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  const name = normalizeCharacterName(requestedName);
  if (!name) {
    return fail(
      `Character names must contain 2–${MAX_CHARACTER_NAME_LENGTH} letters, numbers, spaces, apostrophes, hyphens, or underscores.`,
    );
  }
  if (await findAccountByEmail(email, store)) {
    return fail("That email address is already registered.");
  }
  const duplicateName = (await listPlayers(store)).some((player) =>
    player.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
  );
  if (duplicateName) return fail("That character name is already on file.");

  const { user, error } = await authSignUp(email, password, store);
  if (!user) return fail(error ?? "Signup failed.");

  const now = new Date().toISOString();
  const account: Account = {
    id: `acct_${crypto.randomUUID()}`,
    playerId: `player_${crypto.randomUUID()}`,
    createdAt: now,
    email,
    authUserId: user.id,
  };
  const player = defaultPlayer(account.playerId, name);
  await store.set(accountKey(account.id), account);
  await store.set(accountByEmailKey(email), account.id);
  await savePlayer(player, store);
  const session = await createSession(account.id, store, user.version);
  return { ok: true, reason: null, account, session, player };
}

// ── Login ───────────────────────────────────────────────────────────────────

export async function logIn(
  emailInput: string,
  password: string,
  s?: Store,
): Promise<AuthResult> {
  const store = s ?? await openStore();
  const fail = (reason: string): AuthResult => ({
    ok: false,
    reason,
    account: null,
    session: null,
    player: null,
  });

  const email = normalizeEmail(emailInput);
  if (!email) return fail("Invalid email or password.");
  const account = await findAccountByEmail(email, store);
  if (!account) return fail("Invalid email or password.");
  const user = await authLogIn(email, password, store);
  if (!user) return fail("Invalid email or password.");
  if (account.authUserId && account.authUserId !== user.id) {
    return fail("Invalid email or password.");
  }
  if (!account.authUserId) {
    account.authUserId = user.id;
    await store.set(accountKey(account.id), account);
  }
  const player = await getPlayer(account.playerId, store);
  if (!player) return fail("Your character record is missing.");
  const session = await createSession(account.id, store, user.version);
  return { ok: true, reason: null, account, session, player };
}

// ── Password reset ───────────────────────────────────────────────────────

/**
 * Generate a local recovery link and deliver it through Resend. Always
 * resolves so callers render the same response whether the email exists.
 */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!email) return;
  await authSendRecovery(email);
}

/** Verify the token from an app-owned recovery URL. */
export function verifyPasswordResetToken(
  tokenHash: string,
): Promise<string | null> {
  return tokenHash ? authVerifyRecovery(tokenHash) : Promise.resolve(null);
}

/**
 * Set a new password using the access token from the recovery link.
 */
export async function resetPassword(
  accessToken: string,
  newPassword: string,
): Promise<{ ok: boolean; reason: string | null }> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (!accessToken) {
    return { ok: false, reason: "That reset link is invalid or expired." };
  }
  const { ok, error } = await authUpdatePassword(accessToken, newPassword);
  return { ok, reason: error };
}

// ── Legacy character-only signup (kept for tests/back-compat) ───────────────

/** @deprecated Legacy name-only account creation. Use signUp. */
export async function createCharacterAccount(
  requestedName: string,
  s?: Store,
): Promise<AuthResult> {
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
  const player = defaultPlayer(account.playerId, name);
  await store.set(accountKey(account.id), account);
  await savePlayer(player, store);
  const session = await createSession(account.id, store);
  return { ok: true, reason: null, account, session, player };
}

export async function getPlayerForSession(
  token: string,
  s?: Store,
): Promise<Player | null> {
  if (!token) return null;
  const store = s ?? await openStore();
  const session = await store.get<Omit<PlayerSession, "token">>(
    await sessionKey(token),
  );
  if (!session) return null;
  const expiresAt = session.expiresAt
    ? Date.parse(session.expiresAt)
    : Date.parse(session.createdAt) + SESSION_TTL_MS;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await store.delete(await sessionKey(token));
    return null;
  }
  const account = await store.get<Account>(accountKey(session.accountId));
  if (account?.email) {
    const credential = await store.get<Credential>(
      credentialKey(account.email),
    );
    if (!credential || credential.version !== session.authVersion) return null;
  }
  return account ? getPlayer(account.playerId, store) : null;
}

export async function deleteSession(token: string, s?: Store): Promise<void> {
  if (!token) return;
  await (s ?? await openStore()).delete(await sessionKey(token));
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
  const secure = Deno.env.get("MAIL_ORIGIN_URL")?.startsWith("https://")
    ? "; Secure"
    : "";
  return `${SESSION_COOKIE}=${
    encodeURIComponent(token)
  }; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
