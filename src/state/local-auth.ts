import { compare, hash } from "bcryptjs";
import { Resend } from "resend";
import { openStore, type Store } from "./store.ts";

export interface AuthUser {
  id: string;
  email: string;
  version: string;
}

export interface Credential extends AuthUser {
  passwordHash: string;
  confirmed: boolean;
}

interface ActionToken {
  email: string;
  userId: string;
  version: string;
}

type SendEmail = (
  message: { from: string; to: string; subject: string; html: string },
) => Promise<void>;
let emailStub: SendEmail | null = null;

export function installAuthEmailStub(stub: SendEmail | null): void {
  emailStub = stub;
}

export const credentialKey = (
  email: string,
) => ["auth_credentials", email.trim().toLowerCase()];

export async function tokenHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function randomToken(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(32)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validPassword(password: string): boolean {
  return password.length >= 8 &&
    new TextEncoder().encode(password).length <= 72;
}

function origin(): string {
  return (Deno.env.get("MAIL_ORIGIN_URL") ?? "http://localhost:8000").replace(
    /\/$/,
    "",
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function sendEmail(
  to: string,
  subject: string,
  linkLabel: string,
  actionLink: string,
): Promise<void> {
  const message = {
    from: Deno.env.get("RESEND_FROM_EMAIL") ??
      "FlockWatch <noreply@coolfreakingames.dev>",
    to,
    subject,
    html: `<p>${linkLabel} <a href="${
      escapeHtml(actionLink)
    }">this link</a>.</p>`,
  };
  if (emailStub) return await emailStub(message);
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("email delivery failed: RESEND_API_KEY is not configured");
    return;
  }
  const { error } = await new Resend(apiKey).emails.send(message);
  if (error) console.error("email delivery failed:", error.message);
}

async function issueToken(
  user: AuthUser,
  purpose: string,
  store: Store,
): Promise<string> {
  const token = randomToken();
  await store.setIfAbsent(
    ["auth_tokens", purpose, await tokenHash(token)],
    {
      email: user.email,
      userId: user.id,
      version: user.version,
    } satisfies ActionToken,
    30 * 60_000,
  );
  return token;
}

async function consumeToken(
  token: string,
  purpose: string,
  store: Store,
): Promise<Credential | null> {
  const action = await store.take<ActionToken>([
    "auth_tokens",
    purpose,
    await tokenHash(token),
  ]);
  if (!action) return null;
  const user = await store.get<Credential>(credentialKey(action.email));
  return user?.id === action.userId && user.version === action.version
    ? user
    : null;
}

export async function authSignUp(
  email: string,
  password: string,
  store: Store,
): Promise<{ user: AuthUser | null; error: string | null }> {
  if (!validPassword(password)) {
    return {
      user: null,
      error: "Passwords must be at least 8 characters and at most 72 bytes.",
    };
  }
  const user: Credential = {
    id: crypto.randomUUID(),
    email: email.trim().toLowerCase(),
    version: crypto.randomUUID(),
    passwordHash: await hash(password, 12),
    confirmed: false,
  };
  if (!await store.setIfAbsent(credentialKey(user.email), user)) {
    return { user: null, error: "That email address is already registered." };
  }
  const link = new URL(origin());
  link.searchParams.set(
    "confirm_token",
    await issueToken(user, "confirm", store),
  );
  try {
    await sendEmail(
      user.email,
      "Confirm your FlockWatch account",
      "Confirm your email by opening",
      link.toString(),
    );
  } catch (error) {
    console.error("email delivery failed:", error);
  }
  return {
    user: { id: user.id, email: user.email, version: user.version },
    error: null,
  };
}

export async function authConfirmEmail(token: string): Promise<boolean> {
  const store = await openStore();
  const user = await consumeToken(token, "confirm", store);
  if (!user) return false;
  await store.set(["auth_confirmed", user.id], true);
  return true;
}

export async function authLogIn(
  email: string,
  password: string,
  store: Store,
): Promise<AuthUser | null> {
  if (!validPassword(password)) return null;
  const user = await store.get<Credential>(credentialKey(email));
  if (!user || !await compare(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, version: user.version };
}

export async function authSendRecovery(email: string): Promise<void> {
  const store = await openStore();
  const user = await store.get<Credential>(credentialKey(email));
  if (!user) return;
  const link = new URL(origin());
  link.searchParams.set(
    "reset_token",
    await issueToken(user, "recovery", store),
  );
  try {
    await sendEmail(
      email,
      "Reset your FlockWatch password",
      "A password reset has been requested for your account. To reset your password, please click",
      link.toString(),
    );
  } catch (error) {
    console.error("email delivery failed:", error);
  }
}

export async function authVerifyRecovery(
  token: string,
): Promise<string | null> {
  const store = await openStore();
  const user = await consumeToken(token, "recovery", store);
  return user ? await issueToken(user, "password", store) : null;
}

export async function authUpdatePassword(
  token: string,
  password: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!validPassword(password)) {
    return {
      ok: false,
      error: "Passwords must be at least 8 characters and at most 72 bytes.",
    };
  }
  const store = await openStore();
  const passwordHash = await hash(password, 12);
  const user = await consumeToken(token, "password", store);
  if (
    !user ||
    !await store.setIfAbsent(
      ["auth_password_changes", user.id, user.version],
      true,
    )
  ) {
    return { ok: false, error: "That reset link is invalid or expired." };
  }
  await store.set(credentialKey(user.email), {
    ...user,
    passwordHash,
    version: crypto.randomUUID(),
  });
  return { ok: true, error: null };
}
