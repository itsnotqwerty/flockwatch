/**
 * Minimal client for Supabase Auth (GoTrue) over its REST API.
 * Server-side only — uses the service role key for admin operations and the
 * anon key (or service key as fallback) for user-facing endpoints.
 *
 * Tests set FLOCKWATCH_AUTH=stub and intercept fetch via
 * installAuthFetchStub, so no network is required.
 */

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

type FetchLike = typeof fetch;

let fetchStub: FetchLike | null = null;

/** Test hook: replace the fetch used to reach GoTrue. */
export function installAuthFetchStub(stub: FetchLike | null): void {
  fetchStub = stub;
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
  const { status, data } = await call("/signup", { body: { email, password } });
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
    : data?.id
    ? { id: data.id, email: data.email ?? email }
    : null;
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

/** Send a recovery (password reset) email. Always succeeds silently. */
export async function authSendRecovery(email: string): Promise<void> {
  await call("/recover", { body: { email } });
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
