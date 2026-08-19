/**
 * Player market (spec §3.3) — pure logic. Atomic listings: an item cannot be
 * simultaneously held, listed, and sold.
 */
import type { Item, MarketListing, Player } from "../types.ts";

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
 * List an item for sale. The item must be in the seller's inventory and
 * tradeable; it is removed from inventory while listed (atomic, spec §3.3).
 */
export function createListing(
  seller: Player,
  item: Item,
  price: number,
): MarketResult<{ seller: Player; listing: MarketListing }> {
  if (!item.tradeable) {
    return { ok: false, reason: "That item cannot be traded.", value: { seller, listing: null as unknown as MarketListing } };
  }
  if (!seller.inventory.includes(item.id)) {
    return { ok: false, reason: "You do not hold that item.", value: { seller, listing: null as unknown as MarketListing } };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: "Price must be positive.", value: { seller, listing: null as unknown as MarketListing } };
  }
  listingCounter += 1;
  const listing: MarketListing = {
    id: `lst_${listingCounter}`,
    sellerId: seller.id,
    itemId: item.id,
    price: Math.round(price),
    listedAt: new Date().toISOString(),
  };
  return {
    ok: true,
    reason: null,
    value: { seller: { ...seller, inventory: seller.inventory.filter((i) => i !== item.id) }, listing },
  };
}

/**
 * Buy a listing. The buyer must have funds; currency moves to the seller and
 * the item to the buyer. Sellers may not buy their own listing.
 */
export function buyListing(
  buyer: Player,
  seller: Player,
  listing: MarketListing,
): MarketResult<{ buyer: Player; seller: Player }> {
  if (listing.sellerId === buyer.id) {
    return { ok: false, reason: "You cannot buy your own listing.", value: { buyer, seller } };
  }
  if (buyer.currency < listing.price) {
    return { ok: false, reason: "Insufficient funds.", value: { buyer, seller } };
  }
  return {
    ok: true,
    reason: null,
    value: {
      buyer: {
        ...buyer,
        currency: buyer.currency - listing.price,
        inventory: [...buyer.inventory, listing.itemId],
      },
      seller: { ...seller, currency: seller.currency + listing.price },
    },
  };
}

/** Cancel a listing, returning the item to the seller. */
export function cancelListing(
  seller: Player,
  listing: MarketListing,
): MarketResult<{ seller: Player }> {
  if (listing.sellerId !== seller.id) {
    return { ok: false, reason: "That is not your listing.", value: { seller } };
  }
  return {
    ok: true,
    reason: null,
    value: { seller: { ...seller, inventory: [...seller.inventory, listing.itemId] } },
  };
}
