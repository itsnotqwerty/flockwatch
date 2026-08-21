/**
 * Scheduled stat tick (design §3.3): aggregates camera state into region
 * statistics. Pure logic operating on passed-in data; the caller owns
 * persistence and scheduling.
 */
import type { Camera, Region } from "../types.ts";
import { coverageLevel } from "./cameras.ts";

/**
 * Recompute a region's derived statistics from camera state.
 * Coverage is authoritative from cameras (spec §3.6.3). Unrest drifts with
 * dismantles; Flock presence drifts with installs.
 */
export function tickRegion(region: Region, cameras: Camera[]): Region {
  const regional = cameras.filter((c) => c.region === region.id);
  const coverage = coverageLevel(cameras, region.id);
  const dismantled = regional.filter((c) => c.status === "dismantled").length;
  const resistance = regional.length === 0 ? 0 : dismantled / regional.length;

  // Stats approach camera-war equilibria by a bounded amount per tick. This
  // prevents timer-frequency runaway while keeping shared actions meaningful.
  const targetUnrest = clamp(0.25 + resistance * 0.65 - coverage * 0.2);
  const targetPresence = clamp(0.15 + coverage * 0.75);
  const unrest = approach(region.stats.unrest, targetUnrest, 0.01);
  const flockPresence = approach(
    region.stats.flockPresence,
    targetPresence,
    0.01,
  );
  const targetProsperity = clamp(
    0.65 - unrest * 0.2 - flockPresence * 0.15,
  );
  const prosperity = approach(
    region.stats.prosperity,
    targetProsperity,
    0.005,
  );
  const populationMood = unrest >= 0.7
    ? "defiant"
    : coverage >= 0.7
    ? "subdued"
    : prosperity <= 0.3
    ? "strained"
    : "wary";

  return {
    ...region,
    stats: {
      ...region.stats,
      coverage,
      unrest,
      prosperity,
      flockPresence,
      populationMood,
    },
  };
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
}

function approach(current: number, target: number, step: number): number {
  if (Math.abs(target - current) <= step) return clamp(target);
  return clamp(current + Math.sign(target - current) * step);
}

/** Tick every region. Returns updated regions for the caller to persist. */
export function tickAllRegions(regions: Region[], cameras: Camera[]): Region[] {
  return regions.map((r) => tickRegion(r, cameras));
}
