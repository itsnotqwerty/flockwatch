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
  const active = regional.filter((c) => c.status === "active").length;

  // Gentle drift, clamped to 0..1. Unrest rises with dismantles and falls with
  // coverage; Flock presence follows active installs.
  const unrest = clamp(
    region.stats.unrest + dismantled * 0.02 - coverage * 0.03,
  );
  const flockPresence = clamp(
    region.stats.flockPresence + active * 0.01 - dismantled * 0.02,
  );

  return {
    ...region,
    stats: { ...region.stats, coverage, unrest, flockPresence },
  };
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, Math.round(n * 1000) / 1000));
}

/** Tick every region. Returns updated regions for the caller to persist. */
export function tickAllRegions(regions: Region[], cameras: Camera[]): Region[] {
  return regions.map((r) => tickRegion(r, cameras));
}
