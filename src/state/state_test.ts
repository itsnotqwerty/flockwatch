import { assert, assertEquals } from "$assert";
import { createMemoryStore } from "./store.ts";
import {
  advanceOpening,
  defaultPlayer,
  ensurePlayer,
  getPlayer,
  savePlayer,
} from "./players.ts";
import {
  CONTENT_VERSION,
  ensureContentCurrent,
  getNpc,
  getQuest,
  listNpcs,
  seedContent,
} from "./content.ts";
import { npcs, quests } from "../game/fixtures.ts";
import { getPriceHistory, PRICE_HISTORY_LIMIT, recordSale } from "./market.ts";
import { getRegion, seedRegions } from "./regions.ts";
import type { Region } from "../types.ts";

Deno.test("price history records sales capped at the limit", async () => {
  const store = createMemoryStore();
  const listing = {
    id: "lst_1",
    sellerId: "s1",
    itemId: "binoculars",
    regionId: "cleveland",
    price: 40,
    listedAt: "",
  };
  await recordSale(listing, store);
  await recordSale({ ...listing, price: 60 }, store);
  const history = await getPriceHistory("binoculars", store);
  assertEquals(history.map((p) => p.price), [40, 60]);
  assertEquals(history[0].itemId, "binoculars");
  assertEquals(await getPriceHistory("nothing_sold", store), []);

  // Cap: older entries drop off once the limit is exceeded.
  for (let i = 0; i < PRICE_HISTORY_LIMIT + 5; i++) {
    await recordSale({ ...listing, price: i }, store);
  }
  const capped = await getPriceHistory("binoculars", store);
  assertEquals(capped.length, PRICE_HISTORY_LIMIT);
  assertEquals(capped[capped.length - 1].price, PRICE_HISTORY_LIMIT + 4);
});

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
  assertEquals(fresh.region, "cleveland");
  assertEquals(fresh.location, "memorial_park_service_tunnel");
  assertEquals(fresh.openingStep, "letter");
});

Deno.test("new-character opening advances letter → outside → Memorial Park", () => {
  const created = defaultPlayer("opening", "Missing Citizen");
  assertEquals(created.openingStep, "letter");
  assertEquals(created.location, "memorial_park_service_tunnel");

  const outside = advanceOpening(created);
  assertEquals(outside.openingStep, "outside");

  const entered = advanceOpening(outside);
  assertEquals(entered.openingStep, "complete");
  assertEquals(entered.region, "cleveland");
  assertEquals(entered.location, "memorial_park_service_tunnel");
  assertEquals(advanceOpening(entered), entered);
});

Deno.test("untouched pre-opening mill spawns migrate into the introduction", async () => {
  const store = createMemoryStore();
  const oldDefault = defaultPlayer("old-default", "Unintroduced Citizen");
  const { openingStep: _, ...withoutMarker } = oldDefault;
  await store.set(["players", oldDefault.id], {
    ...withoutMarker,
    location: "cuyahoga_rolling_mill",
  });

  const migrated = await getPlayer(oldDefault.id, store);
  assertEquals(migrated?.openingStep, "letter");
  assertEquals(migrated?.location, "memorial_park_service_tunnel");
});

Deno.test("completed provisional saves receive the missing national quest", async () => {
  const store = createMemoryStore();
  const existing = {
    ...defaultPlayer("handoff", "Provisional Citizen"),
    openingStep: "complete" as const,
    inventory: ["temporary_flock_credential"],
    quests: [{
      questId: "q_provisional_existence",
      status: "completed" as const,
      stageIndex: 2,
    }],
  };
  await store.set(["players", existing.id], existing);

  const migrated = await getPlayer(existing.id, store);
  assertEquals(
    migrated?.quests.find((quest) => quest.questId === "q_the_discrepancy"),
    { questId: "q_the_discrepancy", status: "accepted", stageIndex: 0 },
  );
});

Deno.test("legacy player regions migrate to city ids and a valid sublocation", async () => {
  const store = createMemoryStore();
  await store.set(["players", "legacy"], {
    id: "legacy",
    name: "Earlier Citizen",
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
  });
  const migrated = await getPlayer("legacy", store);
  assertEquals(migrated?.region, "cleveland");
  assertEquals(migrated?.location, "cuyahoga_rolling_mill");
  assertEquals(migrated?.completedLocationActions, []);
  assertEquals(migrated?.openingStep, "complete");
});

Deno.test("region reseeding refreshes authored locations without resetting live stats", async () => {
  const store = createMemoryStore();
  const region: Region = {
    id: "cleveland",
    name: "Cleveland",
    locations: ["old_location"],
    stats: {
      coverage: 0,
      unrest: 0.3,
      prosperity: 0.4,
      flockPresence: 0.7,
      populationMood: "wary",
    },
    economyProfile: { consumes: [], produces: [], wageMultiplier: 1.1 },
  };
  await seedRegions([region], store);
  await store.set(["regions", "cleveland"], {
    ...region,
    stats: { ...region.stats, coverage: 0.75 },
  });
  await seedRegions([{ ...region, locations: ["new_location"] }], store);
  const refreshed = await getRegion("cleveland", store);
  assertEquals(refreshed?.locations, ["new_location"]);
  assertEquals(refreshed?.stats.coverage, 0.75);
});

Deno.test("seedContent stores NPCs and quests without overwriting", async () => {
  const store = createMemoryStore();
  await seedContent(npcs, quests, store);
  assertEquals((await listNpcs(store)).length, npcs.length);
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau");
  assertEquals(
    (await getQuest("q_form_27b", store))?.title,
    "A Matter of Form",
  );

  // Re-seeding preserves an edited record.
  const clerk = (await getNpc("clerk", store))!;
  await store.set(["npcs", "clerk"], {
    ...clerk,
    name: "Clerk Gusteau (Acting)",
  });
  await seedContent(npcs, quests, store);
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau (Acting)");
});

Deno.test("ensureContentCurrent refreshes stale content on version bump", async () => {
  const store = createMemoryStore();
  // Simulate a store seeded by an older build (stale record, old version).
  await seedContent(npcs, quests, store);
  const clerk = (await getNpc("clerk", store))!;
  await store.set(["npcs", "clerk"], {
    ...clerk,
    name: "Clerk Gusteau (Acting)",
  });
  await store.set(["meta", "content_version"], CONTENT_VERSION - 1);

  // Version moved on → records are overwritten, marker is updated.
  assert(await ensureContentCurrent(npcs, quests, store));
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau");
  assertEquals(await store.get(["meta", "content_version"]), CONTENT_VERSION);

  // Same version → no-op.
  await store.set(["npcs", "clerk"], {
    ...clerk,
    name: "Clerk Gusteau (Acting)",
  });
  assert(!(await ensureContentCurrent(npcs, quests, store)));
  assertEquals((await getNpc("clerk", store))?.name, "Clerk Gusteau (Acting)");
});
