import { assert, assertEquals } from "$assert";
import { createMemoryStore } from "./store.ts";
import { defaultPlayer, ensurePlayer, getPlayer, savePlayer } from "./players.ts";
import {
  CONTENT_VERSION,
  ensureContentCurrent,
  getNpc,
  getQuest,
  listNpcs,
  seedContent,
} from "./content.ts";
import { npcs, quests } from "../game/fixtures.ts";

Deno.test("memory store round-trips values", async () => {
  const store = createMemoryStore();
  await store.set(["a", "b"], { n: 1 });
  assertEquals(await store.get(["a", "b"]), { n: 1 });
  assertEquals(await store.get(["a", "missing"]), null);
  await store.delete(["a", "b"]);
  assertEquals(await store.get(["a", "b"]), null);
});

Deno.test("player persistence", async () => {
  const store = createMemoryStore();
  const player = defaultPlayer("p1", "Citizen P1");
  await savePlayer(player, store);
  assertEquals((await getPlayer("p1", store))?.name, "Citizen P1");
  // ensurePlayer creates defaults on first sight.
  const fresh = await ensurePlayer("p2", "Citizen P2", store);
  assertEquals(fresh.currency, 25);
});

Deno.test("seedContent stores NPCs and quests without overwriting", async () => {
  const store = createMemoryStore();
  await seedContent(npcs, quests, store);
  assertEquals((await listNpcs(store)).length, npcs.length);
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau");
  assertEquals((await getQuest("q_form_27b", store))?.title, "A Matter of Form");

  // Re-seeding preserves an edited record.
  const clerk = (await getNpc("clerk", store))!;
  await store.set(["npcs", "clerk"], { ...clerk, name: "Clerk Gusteau (Acting)" });
  await seedContent(npcs, quests, store);
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau (Acting)");
});

Deno.test("ensureContentCurrent refreshes stale content on version bump", async () => {
  const store = createMemoryStore();
  // Simulate a store seeded by an older build (stale record, old version).
  await seedContent(npcs, quests, store);
  const clerk = (await getNpc("clerk", store))!;
  await store.set(["npcs", "clerk"], { ...clerk, name: "Clerk Gusteau (Acting)" });
  await store.set(["meta", "content_version"], CONTENT_VERSION - 1);

  // Version moved on → records are overwritten, marker is updated.
  assert(await ensureContentCurrent(npcs, quests, store));
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau");
  assertEquals(await store.get(["meta", "content_version"]), CONTENT_VERSION);

  // Same version → no-op.
  await store.set(["npcs", "clerk"], { ...clerk, name: "Clerk Gusteau (Acting)" });
  assert(!(await ensureContentCurrent(npcs, quests, store)));
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau (Acting)");
});
