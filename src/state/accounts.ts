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
  installAuthFetchStub,
} from "./supabase-auth.ts";

export const SESSION_COOKIE = "flockwatch_session";
export const MAX_CHARACTER_NAME_LENGTH = 24;
export const MIN_PASSWORD_LENGTH = 8;

const accountKey = (id: string) => ["accounts", id];
const accountByEmailKey = (email: string) => ["account_emails", email];
const sessionKey = (token: string) => ["sessions", token];
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

// ── In-memory auth backend for tests ────────────────────────────────────────
// Enabled by FLOCKWATCH_AUTH=stub; mirrors GoTrue's semantics closely enough
// for unit tests without network access.

interface StubUser {
  id: string;
  email: string;
  password: string;
}

const stubUsers = new Map<string, StubUser>(); // email -> user

/** Test hook: clear all stubbed auth users. */
export function resetAuthStub(): void {
  stubUsers.clear();
}

/** Test hook: wire fetch so GoTrue calls hit the in-memory stub. */
export function installAuthStub(): void {
  installAuthFetchStub((input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (data: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(data), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    if (url.pathname.endsWith("/signup")) {
      const email = String(body.email ?? "").toLowerCase();
      if (stubUsers.has(email)) {
        return json({ msg: "User already registered" }, 422);
      }
      const user = {
        id: crypto.randomUUID(),
        email,
        password: String(body.password ?? ""),
      };
      stubUsers.set(email, user);
      return json({ user: { id: user.id, email: user.email } });
    }
    if (url.pathname.includes("/token")) {
      const email = String(body.email ?? "").toLowerCase();
      const user = stubUsers.get(email);
      if (!user || user.password !== String(body.password ?? "")) {
        return json({ error_description: "Invalid login credentials" }, 400);
      }
      return json({
        access_token: `stub_access_${user.id}`,
        refresh_token: "stub_refresh",
        user: { id: user.id, email: user.email },
      });
    }
    if (url.pathname.endsWith("/recover")) {
      return json({});
    }
    if (url.pathname.endsWith("/user") && init?.method === "PUT") {
      const token = String(
        (init.headers as Record<string, string>)?.["Authorization"] ?? "",
      ).replace("Bearer ", "");
      const user = [...stubUsers.values()].find((u) =>
        `stub_access_${u.id}` === token
      );
      if (!user) return json({ msg: "invalid token" }, 401);
      user.password = String(body.password ?? "");
      return json({ id: user.id, email: user.email });
    }
    return json({ msg: "not found" }, 404);
  });
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function createSession(
  accountId: string,
  store: Store,
): Promise<PlayerSession> {
  const token = crypto.randomUUID();
  const now = Date.now();
  const session: PlayerSession = {
    token,
    accountId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
  await store.setIfAbsent(sessionKey(token), session, SESSION_TTL_MS);
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

  const { user, error } = await authSignUp(email, password);
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
  const session = await createSession(account.id, store);
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
  const { tokens } = await authLogIn(email, password);
  if (!tokens) return fail("Invalid email or password.");
  if (account.authUserId && account.authUserId !== tokens.user.id) {
    return fail("Invalid email or password.");
  }
  if (!account.authUserId) {
    account.authUserId = tokens.user.id;
    await store.set(accountKey(account.id), account);
  }
  const player = await getPlayer(account.playerId, store);
  if (!player) return fail("Your character record is missing.");
  const session = await createSession(account.id, store);
  return { ok: true, reason: null, account, session, player };
}

// ── Password reset (Supabase recovery email + access token) ────────────────

/**
 * Ask Supabase Auth to email a recovery link. Always resolves — callers
 * render the same response whether or not the email exists.
 */
export async function requestPasswordReset(emailInput: string): Promise<void> {
  const email = normalizeEmail(emailInput);
  if (!email) return;
  await authSendRecovery(email);
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
  const session = await store.get<PlayerSession>(sessionKey(token));
  if (!session) return null;
  const expiresAt = session.expiresAt
    ? Date.parse(session.expiresAt)
    : Date.parse(session.createdAt) + SESSION_TTL_MS;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    await store.delete(sessionKey(token));
    return null;
  }
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
