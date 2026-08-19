/**
 * Cameras System (spec §3.6) — pure game logic. No oak, no storage imports.
 *
 * The core loop: install cameras for Flock (wages), or take cameras down
 * (scrap). Takedowns accrue suspicion; regional coverage derives from the
 * count of active cameras.
 */
import type { Camera, Player } from "../types.ts";

let cameraCounter = 0;

/** Reset the id counter (tests). */
export function resetCameraCounter(): void {
  cameraCounter = 0;
}

/** Create a new installation contract offered to a player. */
export function createContract(region: string, baseWage: number): Camera {
  cameraCounter += 1;
  return makeContract(`cam_${region}_${cameraCounter}`, region, baseWage);
}

/** Create a contract with an explicit id (stable, idempotent seeding). */
export function makeContract(id: string, region: string, baseWage: number): Camera {
  return {
    id,
    region,
    status: "contracted",
    installedBy: null,
    wageValue: baseWage,
    scrapYield: ["lens", "housing", "wiring", "circuit_board"],
  };
}

// ── Activity-based refresh timers ────────────────────────────────────────────

/** Cooldown durations (ms) per camera activity. */
export const ACTIVITY_COOLDOWNS = {
  install: 5_000,    // 5s between installs (test-scale)
  dismantle: 12_000, // 12s between takedowns — riskier work
} as const;

export type CameraActivity = keyof typeof ACTIVITY_COOLDOWNS;

/** Milliseconds until the player may perform the activity again (0 = ready). */
export function cooldownRemaining(
  player: Player,
  activity: CameraActivity,
  now = Date.now(),
): number {
  const readyAt = player.timers?.[activity] ?? 0;
  return Math.max(0, readyAt - now);
}

export function canPerform(player: Player, activity: CameraActivity, now = Date.now()): boolean {
  return cooldownRemaining(player, activity, now) === 0;
}

/** Stamp the activity's refresh timer to now + its cooldown. */
export function stampActivity(
  player: Player,
  activity: CameraActivity,
  now = Date.now(),
): Player {
  return {
    ...player,
    timers: { ...player.timers, [activity]: now + ACTIVITY_COOLDOWNS[activity] },
  };
}

/**
 * Fulfill a contract: the camera goes active and the installer is paid wages
 * (scaled by the region's wage multiplier). No-op for non-contracted cameras
 * or while the install refresh timer is still running.
 */
export function installCamera(
  camera: Camera,
  player: Player,
  wageMultiplier = 1,
  now = Date.now(),
): { camera: Camera; player: Player; wages: number } {
  if (camera.status !== "contracted" || !canPerform(player, "install", now)) {
    return { camera, player, wages: 0 };
  }
  const wages = Math.round(camera.wageValue * wageMultiplier);
  return {
    camera: { ...camera, status: "active", installedBy: player.id },
    player: { ...stampActivity(player, "install", now), currency: player.currency + wages },
    wages,
  };
}

/** Suspicion gained per takedown scales with regional coverage (0.0–1.0). */
export function suspicionForTakedown(coverage: number): number {
  return Math.round(10 + coverage * 30);
}

/**
 * Dismantle an active camera: the player gains its scrap yield and accrues
 * suspicion scaled by regional coverage. No-op for non-active cameras or while
 * the dismantle refresh timer is still running.
 */
export function dismantleCamera(
  camera: Camera,
  player: Player,
  coverage: number,
  now = Date.now(),
): { camera: Camera; player: Player } {
  if (camera.status !== "active" || !canPerform(player, "dismantle", now)) {
    return { camera, player };
  }
  const scrap = { ...player.scrap };
  for (const component of camera.scrapYield) {
    scrap[component] = (scrap[component] ?? 0) + 1;
  }
  return {
    camera: { ...camera, status: "dismantled" },
    player: {
      ...stampActivity(player, "dismantle", now),
      scrap,
      suspicion: player.suspicion + suspicionForTakedown(coverage),
    },
  };
}

/** Regional coverage: active cameras per total non-contracted sites (§3.6.3). */
export function coverageLevel(cameras: Camera[], region: string): number {
  const regional = cameras.filter(
    (c) => c.region === region && c.status !== "contracted",
  );
  if (regional.length === 0) return 0;
  const active = regional.filter((c) => c.status === "active").length;
  return active / regional.length;
}

/** Sum a player's scrapped component counts. */
export function totalScrap(player: Player): number {
  return Object.values(player.scrap).reduce((sum, n) => sum + (n ?? 0), 0);
}
