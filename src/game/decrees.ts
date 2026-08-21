/**
 * Ministry of Valuation decrees (spec §3.3) — pure logic. Decrees are live-ops
 * price modifiers applied to market transactions while in force.
 */
import type { Decree } from "../types.ts";

/**
 * The combined price multiplier from all decrees in force for a region.
 * National and regional decrees stack multiplicatively.
 */
export function decreeMultiplier(
  decrees: Decree[],
  region: string,
  now = Date.now(),
): number {
  return activeDecrees(decrees, region, now)
    .reduce((m, d) => m * d.priceMultiplier, 1);
}

/** Decrees in force for a region right now. */
export function activeDecrees(
  decrees: Decree[],
  region: string,
  now = Date.now(),
): Decree[] {
  return decrees.filter((d) => {
    if (Date.parse(d.expiresAt) <= now) return false;
    return d.scope === "national" || d.region === region;
  });
}

/** Apply the decree multiplier to a listing's asking price. */
export function decreedPrice(
  basePrice: number,
  decrees: Decree[],
  region: string,
  now = Date.now(),
): number {
  return Math.max(
    1,
    Math.round(basePrice * decreeMultiplier(decrees, region, now)),
  );
}

/** Build a decree record (used by the tick to proclaim new decrees). */
export function makeDecree(
  id: string,
  title: string,
  proclamation: string,
  priceMultiplier: number,
  scope: "national" | "regional",
  region: string | null,
  now = Date.now(),
  ttlMs = 7 * 24 * 60 * 60 * 1000,
): Decree {
  return {
    id,
    title,
    proclamation,
    priceMultiplier,
    scope,
    region,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}
