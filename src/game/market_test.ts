import { assert, assertEquals } from "$assert";
import {
  buyListing,
  cancelListing,
  createListing,
  resetListingCounter,
  summarizePrices,
} from "./market.ts";
import type { Item, Player, PricePoint } from "../types.ts";

const binoculars: Item = {
  id: "binoculars",
  name: "Standard-Issue Binoculars",
  description: "For watching.",
  rarity: "common",
  tradeable: true,
};
const permit: Item = { ...binoculars, id: "ladder_permit", tradeable: false };

function player(over: Partial<Player> = {}): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    ...over,
  };
}

Deno.test("createListing removes the item from inventory (atomic)", () => {
  resetListingCounter();
  const seller = player({ id: "s1", inventory: ["binoculars"] });
  const result = createListing(seller, binoculars, 40);
  assert(result.ok);
  assertEquals(result.value.seller.inventory, []);
  assertEquals(result.value.listing.price, 40);
  assertEquals(result.value.listing.itemId, "binoculars");
  assertEquals(result.value.listing.regionId, "rust_belt"); // regional board
});

Deno.test("createListing rejects untradeable, unheld, and bad-price listings", () => {
  const seller = player({ inventory: ["binoculars", "ladder_permit"] });
  assert(!createListing(seller, permit, 10).ok); // untradeable
  assert(!createListing(seller, { ...binoculars, id: "not_held" }, 10).ok); // not held
  assert(!createListing(seller, binoculars, 0).ok); // bad price
  assert(!createListing(seller, binoculars, -5).ok);
});

Deno.test("buyListing moves currency and item between players", () => {
  const seller = player({ id: "s1", inventory: ["binoculars"] });
  const { value } = createListing(seller, binoculars, 50);
  const buyer = player({ id: "b1", currency: 100 });
  const result = buyListing(buyer, value.seller, value.listing);
  assert(result.ok);
  assertEquals(result.value.buyer.currency, 50);
  assert(result.value.buyer.inventory.includes("binoculars"));
  assertEquals(result.value.seller.currency, 50);
  assertEquals(result.value.paid, 50);
});

Deno.test("buyListing applies decree multipliers and flag surcharges", () => {
  const seller = player({ id: "s1", inventory: ["binoculars"] });
  const { value } = createListing(seller, binoculars, 50);
  const decree = {
    id: "d1",
    title: "T",
    proclamation: "P",
    priceMultiplier: 1.2,
    scope: "national" as const,
    region: null,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
  };
  // Clean buyer: pays the decreed price (60), seller receives 60.
  const clean = buyListing(player({ id: "b1", currency: 100 }), value.seller, value.listing, [decree]);
  assert(clean.ok);
  assertEquals(clean.value.paid, 60);
  assertEquals(clean.value.seller.currency, 60);
  // Flagged buyer: 10% surcharge on top, Ministry keeps the surcharge.
  const flagged = player({
    id: "b2",
    currency: 100,
    flags: [{ id: "f1", region: "rust_belt", action: "tail", reason: "made", flaggedAt: "" }],
  });
  const dirty = buyListing(flagged, value.seller, value.listing, [decree]);
  assert(dirty.ok);
  assertEquals(dirty.value.paid, 69); // 60 * 1.15 flag surcharge
  assertEquals(dirty.value.seller.currency, 60);
});

Deno.test("buyListing rejects self-purchase and insufficient funds", () => {
  const seller = player({ id: "s1", inventory: ["binoculars"] });
  const { value } = createListing(seller, binoculars, 50);
  const listing = value.listing;
  assert(!buyListing(value.seller, value.seller, listing).ok); // self
  assert(!buyListing(player({ id: "b2", currency: 10 }), value.seller, listing).ok); // poor
});

Deno.test("cancelListing returns the item to the seller only", () => {
  const seller = player({ id: "s1", inventory: ["binoculars"] });
  const { value } = createListing(seller, binoculars, 50);
  const back = cancelListing(value.seller, value.listing);
  assert(back.ok);
  assert(back.value.seller.inventory.includes("binoculars"));
  // Someone else cannot cancel it.
  assert(!cancelListing(player({ id: "stranger" }), value.listing).ok);
});

Deno.test("summarizePrices returns null with no sales", () => {
  assertEquals(summarizePrices([]), null);
});

Deno.test("summarizePrices computes last, min, max, and average", () => {
  const history: PricePoint[] = [
    { itemId: "binoculars", price: 40, soldAt: "2026-08-01T00:00:00Z" },
    { itemId: "binoculars", price: 60, soldAt: "2026-08-02T00:00:00Z" },
    { itemId: "binoculars", price: 50, soldAt: "2026-08-03T00:00:00Z" },
  ];
  assertEquals(summarizePrices(history), {
    sales: 3,
    last: 50,
    min: 40,
    max: 60,
    average: 50,
  });
});
