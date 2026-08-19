import type { MarketListing } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["market", id];

export async function getListing(id: string, s?: Store): Promise<MarketListing | null> {
  return (s ?? await openStore()).get<MarketListing>(key(id));
}

export async function saveListing(listing: MarketListing, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(listing.id), listing);
}

export async function deleteListing(id: string, s?: Store): Promise<void> {
  await (s ?? await openStore()).delete(key(id));
}

export async function listListings(s?: Store): Promise<MarketListing[]> {
  const entries = await (s ?? await openStore()).list<MarketListing>(["market"]);
  return entries.map((e) => e.value);
}
