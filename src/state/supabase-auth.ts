/**
 * Minimal client for Supabase Auth (GoTrue) over its REST API.
 * Supabase owns credentials and generates action links; Resend delivers them.
 */

import { Resend } from "resend";

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface EmailResponse {
  id: string;
}

type FetchLike = typeof fetch;
type SendEmail = (message: {
  from: string;
  to: string;
  subject: string;
  html: string;
}) => Promise<void>;

let fetchStub: FetchLike | null = null;
let emailStub: SendEmail | null = null;

/** Test hook: replace the fetch used to reach GoTrue. */
export function installAuthFetchStub(stub: FetchLike | null): void {
  fetchStub = stub;
}

/** Test hook: replace Resend delivery. */
export function installAuthEmailStub(stub: SendEmail | null): void {
  emailStub = stub;
}

function baseUrl(): string | null {
  const url = Deno.env.get("SUPABASE_URL") ??
    (fetchStub ? "https://auth.stub" : null);
  return url ? `${url}/auth/v1` : null;
}

function anonKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    "";
}

function serviceKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    "";
}

function origin(): string {
  return (Deno.env.get("MAIL_ORIGIN_URL") ?? "http://localhost:8000").replace(
    /\/$/,
    "",
  );
}

function emailFrom(): string {
  return Deno.env.get("RESEND_FROM_EMAIL") ??
    "FlockWatch <noreply@coolfreakingames.dev>";
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
    from: emailFrom(),
    to,
    subject,
    html: `<p>${linkLabel} <a href="${
      escapeHtml(actionLink)
    }">this link</a>.</p>`,
  };
  if (emailStub) {
    await emailStub(message);
    return;
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("email delivery failed: RESEND_API_KEY is not configured");
    return;
  }
  const { error } = await new Resend(apiKey).emails.send(message);
  if (error) console.error("email delivery failed:", error.message);
}

async function call(
  path: string,
  init: { method?: string; key?: string; token?: string; body?: unknown } = {},
  // deno-lint-ignore no-explicit-any
): Promise<{ status: number; data: any }> {
  const f = fetchStub ?? fetch;
  const base = baseUrl();
  if (!base) {
    console.error("auth request failed: SUPABASE_URL is not configured");
    return { status: 0, data: null };
  }
  let res: Response;
  try {
    res = await f(`${base}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        "apikey": init.key ?? anonKey(),
        "Authorization": `Bearer ${init.token ?? init.key ?? anonKey()}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) {
    console.error("auth request failed:", e);
    return { status: 0, data: null };
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

// deno-lint-ignore no-explicit-any
function toTokens(data: any): AuthTokens | null {
  if (!data?.access_token || !data?.user?.id) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? "",
    user: { id: data.user.id, email: data.user.email ?? "" },
  };
}

/** Sign up a new user. Returns the user, or null on failure. */
export async function authSignUp(
  email: string,
  password: string,
): Promise<{ user: AuthUser | null; error: string | null }> {
  const { status, data } = await call("/admin/generate_link", {
    key: serviceKey(),
    body: {
      type: "signup",
      email,
      password,
      redirect_to: origin(),
    },
  });
  if (status === 0) {
    return {
      user: null,
      error: "Account services are unavailable. Try again shortly.",
    };
  }
  if (status >= 400) {
    return {
      user: null,
      error: data?.msg ?? data?.error_description ?? "Signup failed.",
    };
  }
  const user = data?.user?.id
    ? { id: data.user.id, email: data.user.email ?? email }
    : null;
  if (user && data?.action_link) {
    try {
      await sendEmail(
        user.email,
        "Confirm your FlockWatch account",
        "Confirm your email by opening",
        data.action_link,
      );
    } catch (error) {
      console.error("email delivery failed:", error);
    }
  }
  return { user, error: user ? null : "Signup failed." };
}

/** Password grant login. */
export async function authLogIn(
  email: string,
  password: string,
): Promise<{ tokens: AuthTokens | null; error: string | null }> {
  const { status, data } = await call("/token?grant_type=password", {
    body: { email, password },
  });
  if (status === 0) {
    return {
      tokens: null,
      error: "Account services are unavailable. Try again shortly.",
    };
  }
  if (status >= 400) {
    return { tokens: null, error: "Invalid email or password." };
  }
  const tokens = toTokens(data);
  return { tokens, error: tokens ? null : "Invalid email or password." };
}

/** Generate and send a recovery link through Resend. Always succeeds silently. */
export async function authSendRecovery(email: string): Promise<void> {
  const { status, data } = await call("/admin/generate_link", {
    key: serviceKey(),
    body: {
      type: "recovery",
      email,
    },
  });
  if (status >= 400 || !data?.hashed_token) return;
  const resetUrl = new URL(origin());
  resetUrl.searchParams.set("reset_token", data.hashed_token);
  try {
    await sendEmail(
      email,
      "Reset your FlockWatch password",
      "A password reset has been requested for your account. To reset your password, please click",
      resetUrl.toString(),
    );
  } catch (error) {
    console.error("email delivery failed:", error);
  }
}

/** Exchange an app-delivered recovery token for a Supabase access token. */
export async function authVerifyRecovery(
  tokenHash: string,
): Promise<string | null> {
  const { status, data } = await call("/verify", {
    body: { type: "recovery", token_hash: tokenHash },
  });
  if (status >= 400) return null;
  return toTokens(data)?.accessToken ?? null;
}

/** Set a new password using the access token from the recovery link. */
export async function authUpdatePassword(
  accessToken: string,
  password: string,
): Promise<{ ok: boolean; error: string | null }> {
  const { status, data } = await call("/user", {
    method: "PUT",
    token: accessToken,
    body: { password },
  });
  if (status === 0) {
    return {
      ok: false,
      error: "Account services are unavailable. Try again shortly.",
    };
  }
  if (status >= 400) {
    return {
      ok: false,
      error: data?.msg ?? "That reset link is invalid or expired.",
    };
  }
  return { ok: true, error: null };
}
