import type { MarketListing, PricePoint } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (regionId: string, id: string) => ["market", regionId, id];
const historyKey = (itemId: string) => ["price_history", itemId];

/** Cap on recorded sales kept per item. */
export const PRICE_HISTORY_LIMIT = 25;

export async function getListing(
  regionId: string,
  id: string,
  s?: Store,
): Promise<MarketListing | null> {
  return (s ?? await openStore()).get<MarketListing>(key(regionId, id));
}

export async function saveListing(
  listing: MarketListing,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).set(
    key(listing.regionId, listing.id),
    listing,
  );
}

export async function deleteListing(
  regionId: string,
  id: string,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).delete(key(regionId, id));
}

/** All listings on one region's market board (spec §3.0 local economies). */
export async function listListings(
  regionId: string,
  s?: Store,
): Promise<MarketListing[]> {
  const entries = await (s ?? await openStore()).list<MarketListing>([
    "market",
    regionId,
  ]);
  return entries.map((e) => e.value);
}

/** Record a completed sale in the item's price history. */
export async function recordSale(
  listing: MarketListing,
  s?: Store,
): Promise<void> {
  const store = s ?? await openStore();
  const history = (await store.get<PricePoint[]>(historyKey(listing.itemId))) ??
    [];
  history.push({
    itemId: listing.itemId,
    price: listing.price,
    soldAt: new Date().toISOString(),
  });
  if (history.length > PRICE_HISTORY_LIMIT) {
    history.splice(0, history.length - PRICE_HISTORY_LIMIT);
  }
  await store.set(historyKey(listing.itemId), history);
}

/** Recorded sales for an item, oldest first. */
export async function getPriceHistory(
  itemId: string,
  s?: Store,
): Promise<PricePoint[]> {
  return (await (s ?? await openStore()).get<PricePoint[]>(
    historyKey(itemId),
  )) ?? [];
}
