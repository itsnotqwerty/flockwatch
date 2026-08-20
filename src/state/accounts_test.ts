import { assert, assertEquals } from "$assert";
import {
  createCharacterAccount,
  expiredSessionCookie,
  getPlayerForSession,
  normalizeCharacterName,
  sessionCookie,
  sessionTokenFromCookie,
} from "./accounts.ts";
import { createMemoryStore } from "./store.ts";

Deno.test("character names are normalized and constrained", () => {
  assertEquals(normalizeCharacterName("  Citizen   Jane  "), "Citizen Jane");
  assertEquals(normalizeCharacterName("x"), null);
  assertEquals(normalizeCharacterName("Citizen<script>"), null);
});

Deno.test("accounts persist a character and reject duplicate names", async () => {
  const store = createMemoryStore();
  const created = await createCharacterAccount("Citizen Jane", store);
  assert(created.ok);
  assertEquals(
    (await getPlayerForSession(created.session!.token, store))?.name,
    "Citizen Jane",
  );
  const duplicate = await createCharacterAccount("citizen jane", store);
  assert(!duplicate.ok);
});

Deno.test("session cookies round-trip and expire", () => {
  const header = sessionCookie("token=value");
  assertEquals(sessionTokenFromCookie(`other=x; ${header}`), "token=value");
  assert(expiredSessionCookie().includes("Max-Age=0"));
});
