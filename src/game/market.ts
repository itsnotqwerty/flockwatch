/**
 * Player market (spec §3.3) — pure logic. Atomic listings: an item cannot be
 * simultaneously held, listed, and sold.
 */
import type {
  Decree,
  Item,
  MarketListing,
  Player,
  PricePoint,
} from "../types.ts";
import { decreedPrice } from "./decrees.ts";
import { marketFeeRate } from "./espionage.ts";

let listingCounter = 0;

/** Reset the id counter (tests). */
export function resetListingCounter(): void {
  listingCounter = 0;
}

export interface MarketResult<T> {
  ok: boolean;
  reason: string | null;
  value: T;
}

/**
 * List an item for sale on the seller's regional market board. The item must
 * be in the seller's inventory and tradeable; it is removed from inventory
 * while listed (atomic, spec §3.3).
 */
export function createListing(
  seller: Player,
  item: Item,
  price: number,
): MarketResult<{ seller: Player; listing: MarketListing }> {
  if (!item.tradeable) {
    return {
      ok: false,
      reason: "That item cannot be traded.",
      value: { seller, listing: null as unknown as MarketListing },
    };
  }
  if (!seller.inventory.includes(item.id)) {
    return {
      ok: false,
      reason: "You do not hold that item.",
      value: { seller, listing: null as unknown as MarketListing },
    };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return {
      ok: false,
      reason: "Price must be positive.",
      value: { seller, listing: null as unknown as MarketListing },
    };
  }
  listingCounter += 1;
  const listing: MarketListing = {
    id: `lst_${listingCounter}`,
    sellerId: seller.id,
    itemId: item.id,
    regionId: seller.region,
    price: Math.round(price),
    listedAt: new Date().toISOString(),
  };
  return {
    ok: true,
    reason: null,
    value: {
      seller: {
        ...seller,
        inventory: seller.inventory.filter((i) => i !== item.id),
      },
      listing,
    },
  };
}

/**
 * The total a buyer actually pays: the listing price adjusted by any Ministry
 * of Valuation decree in force, plus a market-fee surcharge for flagged
 * players (spec §3.5 espionage consequences).
 */
export function purchasePrice(
  listing: MarketListing,
  buyer: Player,
  decrees: Decree[] = [],
  now = Date.now(),
): number {
  const base = decreedPrice(listing.price, decrees, listing.regionId, now);
  return Math.round(base * (1 + marketFeeRate(buyer)));
}

/**
 * Buy a listing. The buyer pays the decreed price plus any flag surcharge;
 * the seller receives the decreed price (the Ministry keeps the surcharge).
 * Sellers may not buy their own listing.
 */
export function buyListing(
  buyer: Player,
  seller: Player,
  listing: MarketListing,
  decrees: Decree[] = [],
  now = Date.now(),
): MarketResult<{ buyer: Player; seller: Player; paid: number }> {
  if (listing.sellerId === buyer.id) {
    return {
      ok: false,
      reason: "You cannot buy your own listing.",
      value: { buyer, seller, paid: 0 },
    };
  }
  const paid = purchasePrice(listing, buyer, decrees, now);
  if (buyer.currency < paid) {
    return {
      ok: false,
      reason: "Insufficient funds.",
      value: { buyer, seller, paid },
    };
  }
  const proceeds = decreedPrice(listing.price, decrees, listing.regionId, now);
  return {
    ok: true,
    reason: null,
    value: {
      buyer: {
        ...buyer,
        currency: buyer.currency - paid,
        inventory: [...buyer.inventory, listing.itemId],
      },
      seller: { ...seller, currency: seller.currency + proceeds },
      paid,
    },
  };
}

/** Cancel a listing, returning the item to the seller. */
export function cancelListing(
  seller: Player,
  listing: MarketListing,
): MarketResult<{ seller: Player }> {
  if (listing.sellerId !== seller.id) {
    return {
      ok: false,
      reason: "That is not your listing.",
      value: { seller },
    };
  }
  return {
    ok: true,
    reason: null,
    value: {
      seller: { ...seller, inventory: [...seller.inventory, listing.itemId] },
    },
  };
}

// ── Price history (spec §3.3) ───────────────────────────────────────────────

export interface PriceSummary {
  sales: number;
  last: number;
  min: number;
  max: number;
  average: number;
}

/**
 * Summarize an item's recorded sales. `history` is oldest-first; returns null
 * when no sales have been recorded.
 */
export function summarizePrices(history: PricePoint[]): PriceSummary | null {
  if (history.length === 0) return null;
  const prices = history.map((p) => p.price);
  const total = prices.reduce((a, b) => a + b, 0);
  return {
    sales: prices.length,
    last: prices[prices.length - 1],
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: Math.round(total / prices.length),
  };
}
