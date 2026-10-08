import { assert, assertEquals } from "$assert";
import {
  createCharacterAccount,
  expiredSessionCookie,
  getPlayerForSession,
  logIn,
  normalizeCharacterName,
  normalizeEmail,
  requestPasswordReset,
  resetPassword,
  sessionCookie,
  sessionTokenFromCookie,
  signUp,
  verifyPasswordResetToken,
} from "./accounts.ts";
import { authConfirmEmail, installAuthEmailStub } from "./local-auth.ts";
import { createMemoryStore, useStore } from "./store.ts";

installAuthEmailStub(() => Promise.resolve());

Deno.test("character names are normalized and constrained", () => {
  assertEquals(normalizeCharacterName("  Citizen   Jane  "), "Citizen Jane");
  assertEquals(normalizeCharacterName("x"), null);
  assertEquals(normalizeCharacterName("Citizen<script>"), null);
});

Deno.test("emails are normalized and validated", () => {
  assertEquals(normalizeEmail("  Jane@Example.COM "), "jane@example.com");
  assertEquals(normalizeEmail("not-an-email"), null);
  assertEquals(normalizeEmail("a@b"), null);
});

Deno.test("accounts persist a character and reject duplicate names", async () => {
  const store = createMemoryStore();
  const created = await createCharacterAccount("Citizen Jane", store);
  assert(created.ok);
  assertEquals(
    (await getPlayerForSession(created.session!.token, store))?.name,
    "Citizen Jane",
  );
  assertEquals(created.player?.openingStep, "letter");
  assertEquals(created.player?.location, "memorial_park_service_tunnel");
  const duplicate = await createCharacterAccount("citizen jane", store);
  assert(!duplicate.ok);
});

Deno.test("session cookies round-trip and expire", () => {
  const header = sessionCookie("token=value");
  assertEquals(sessionTokenFromCookie(`other=x; ${header}`), "token=value");
  assert(expiredSessionCookie().includes("Max-Age=0"));
});

Deno.test("HTTPS deployments set Secure session cookies", () => {
  const origin = Deno.env.get("MAIL_ORIGIN_URL");
  try {
    Deno.env.set("MAIL_ORIGIN_URL", "https://flockwatch.example.com");
    assert(sessionCookie("test-token").includes("; Secure"));
  } finally {
    if (origin === undefined) Deno.env.delete("MAIL_ORIGIN_URL");
    else Deno.env.set("MAIL_ORIGIN_URL", origin);
  }
});

Deno.test("signup creates an email account and rejects duplicates", async () => {
  const store = createMemoryStore();
  const created = await signUp(
    "Jane@Example.com",
    "correct horse battery",
    "Citizen Jane",
    store,
  );
  assert(created.ok, created.reason ?? "signup failed");
  assertEquals(created.account?.email, "jane@example.com");
  assert(created.account?.authUserId);
  assertEquals(
    (await getPlayerForSession(created.session!.token, store))?.name,
    "Citizen Jane",
  );

  const dupEmail = await signUp(
    "jane@example.com",
    "whatever password",
    "Other Name",
    store,
  );
  assert(!dupEmail.ok);
  const dupName = await signUp(
    "other@example.com",
    "whatever password",
    "citizen jane",
    store,
  );
  assert(!dupName.ok);
  const short = await signUp("new@example.com", "short", "New Name", store);
  assert(!short.ok);
});

Deno.test("signup and recovery emails use local one-use links", async () => {
  const store = createMemoryStore();
  useStore(store);
  const messages: Array<{ to: string; subject: string; html: string }> = [];
  installAuthEmailStub((message) => {
    messages.push(message);
    return Promise.resolve();
  });

  try {
    await signUp(
      "jane@example.com",
      "correct horse battery",
      "Citizen Jane",
      store,
    );
    await requestPasswordReset("jane@example.com");

    assertEquals(messages.length, 2);
    assertEquals(messages[0].to, "jane@example.com");
    assert(messages[0].subject.includes("Confirm"));
    const confirm = new URL(messages[0].html.match(/href="([^"]+)"/)![1])
      .searchParams.get("confirm_token")!;
    assert(await authConfirmEmail(confirm));
    assertEquals(await authConfirmEmail(confirm), false);
    assert(messages[1].subject.includes("Reset"));
    assert(messages[1].html.startsWith(
      '<p>A password reset has been requested for your account. To reset your password, please click <a href="',
    ));
    assert(messages[1].html.includes("/?reset_token="));
    assert(messages[1].html.endsWith('">this link</a>.</p>'));
    assert(!messages[1].html.includes("#access_token"));
  } finally {
    installAuthEmailStub(() => Promise.resolve());
  }
});

Deno.test("login verifies the password and opens a session", async () => {
  const store = createMemoryStore();
  await signUp(
    "jane@example.com",
    "correct horse battery",
    "Citizen Jane",
    store,
  );

  const bad = await logIn("jane@example.com", "wrong password", store);
  assert(!bad.ok);
  const unknown = await logIn("nobody@example.com", "whatever1", store);
  assert(!unknown.ok);
  assertEquals(bad.reason, unknown.reason); // no enumeration hints

  const good = await logIn("JANE@example.com", "correct horse battery", store);
  assert(good.ok, good.reason ?? "login failed");
  assertEquals(
    (await getPlayerForSession(good.session!.token, store))?.name,
    "Citizen Jane",
  );
});

Deno.test("password reset via recovery access token", async () => {
  const store = createMemoryStore();
  useStore(store);
  const messages: string[] = [];
  installAuthEmailStub((message) => {
    messages.push(message.html);
    return Promise.resolve();
  });
  await signUp("jane@example.com", "old password 1", "Citizen Jane", store);

  const login = await logIn("jane@example.com", "old password 1", store);
  assert(login.ok);
  await requestPasswordReset("jane@example.com");
  const recoveryToken = new URL(messages.at(-1)!.match(/href="([^"]+)"/)![1])
    .searchParams.get("reset_token")!;
  const token = await verifyPasswordResetToken(recoveryToken);
  assert(token);
  assertEquals(await verifyPasswordResetToken(recoveryToken), null);

  const short = await resetPassword(token, "short");
  assert(!short.ok);
  const badToken = await resetPassword("bogus", "new password 2");
  assert(!badToken.ok);

  const reset = await resetPassword(token, "new password 2");
  assert(reset.ok, reset.reason ?? "reset failed");
  assertEquals(await getPlayerForSession(login.session!.token, store), null);
  assertEquals((await resetPassword(token, "another password")).ok, false);

  assert(!(await logIn("jane@example.com", "old password 1", store)).ok);
  assert((await logIn("jane@example.com", "new password 2", store)).ok);
  installAuthEmailStub(() => Promise.resolve());
});

Deno.test("recovery tokens expire and unknown emails do not send mail", async () => {
  const store = createMemoryStore();
  useStore(store);
  const messages: string[] = [];
  installAuthEmailStub((message) => {
    messages.push(message.html);
    return Promise.resolve();
  });
  const originalNow = Date.now;
  try {
    await signUp("expiry@example.com", "test password", "Expiry Test", store);
    await requestPasswordReset("nobody@example.com");
    assertEquals(messages.length, 1);
    await requestPasswordReset("expiry@example.com");
    const token = new URL(messages.at(-1)!.match(/href="([^"]+)"/)![1])
      .searchParams.get("reset_token")!;
    const future = originalNow() + 31 * 60_000;
    Date.now = () => future;
    assertEquals(await verifyPasswordResetToken(token), null);
  } finally {
    Date.now = originalNow;
    installAuthEmailStub(() => Promise.resolve());
  }
});
