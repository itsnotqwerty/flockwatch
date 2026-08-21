import { assert, assertEquals } from "$assert";
import {
  createCharacterAccount,
  expiredSessionCookie,
  getPlayerForSession,
  installAuthStub,
  logIn,
  normalizeCharacterName,
  normalizeEmail,
  resetAuthStub,
  resetPassword,
  sessionCookie,
  sessionTokenFromCookie,
  signUp,
} from "./accounts.ts";
import { createMemoryStore } from "./store.ts";

// Route GoTrue calls to the in-memory stub (no network in tests).
installAuthStub();

Deno.test("character names are normalized and constrained", () => {
  resetAuthStub();
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

Deno.test("signup creates an email account and rejects duplicates", async () => {
  resetAuthStub();
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

Deno.test("login verifies the password and opens a session", async () => {
  resetAuthStub();
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
  resetAuthStub();
  const store = createMemoryStore();
  await signUp("jane@example.com", "old password 1", "Citizen Jane", store);

  // The recovery link carries the access token; the stub issues
  // "stub_access_<userId>" on login, and PUT /user accepts it.
  const login = await logIn("jane@example.com", "old password 1", store);
  assert(login.ok);
  const account = login.account!;
  const token = `stub_access_${account.authUserId}`;

  const short = await resetPassword(token, "short");
  assert(!short.ok);
  const badToken = await resetPassword("bogus", "new password 2");
  assert(!badToken.ok);

  const reset = await resetPassword(token, "new password 2");
  assert(reset.ok, reset.reason ?? "reset failed");

  assert(!(await logIn("jane@example.com", "old password 1", store)).ok);
  assert((await logIn("jane@example.com", "new password 2", store)).ok);
});
