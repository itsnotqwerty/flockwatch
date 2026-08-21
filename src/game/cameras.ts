/**
 * Cameras System (spec §3.6) — pure game logic. No oak, no storage imports.
 *
 * The core loop: install cameras for Flock (wages), or take cameras down
 * (scrap). Takedowns accrue suspicion; regional coverage derives from the
 * count of active cameras.
 */
import type { Camera, CameraCooldowns, Player } from "../types.ts";
import {
  cameraTakedownReduction,
  eventSuspicionReduction,
} from "./item-effects.ts";

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
export function makeContract(
  id: string,
  region: string,
  baseWage: number,
): Camera {
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
  install: 5_000, // 5s between installs (test-scale)
  dismantle: 12_000, // 12s between takedowns — riskier work
} as const;

export type CameraActivity = keyof typeof ACTIVITY_COOLDOWNS;

/**
 * Cooldowns are region-wide: installing a camera puts the whole region on
 * cooldown for every player, so Flock installation proceeds at a steady pace.
 */
export function cooldownRemaining(
  cooldowns: CameraCooldowns | undefined,
  activity: CameraActivity,
  now = Date.now(),
): number {
  const readyAt = cooldowns?.[activity] ?? 0;
  return Math.max(0, readyAt - now);
}

export function canPerform(
  cooldowns: CameraCooldowns | undefined,
  activity: CameraActivity,
  now = Date.now(),
): boolean {
  return cooldownRemaining(cooldowns, activity, now) === 0;
}

/** Stamp the region's activity refresh timer to now + its cooldown. */
export function stampActivity(
  cooldowns: CameraCooldowns | undefined,
  activity: CameraActivity,
  now = Date.now(),
): CameraCooldowns {
  return { ...cooldowns, [activity]: now + ACTIVITY_COOLDOWNS[activity] };
}

/**
 * Fulfill a contract: the camera goes active and the installer is paid wages
 * (scaled by the region's wage multiplier). No-op for non-contracted cameras
 * or while the region's install refresh timer is still running.
 */
export function installCamera(
  camera: Camera,
  player: Player,
  cooldowns: CameraCooldowns | undefined,
  wageMultiplier = 1,
  now = Date.now(),
): {
  camera: Camera;
  player: Player;
  cooldowns: CameraCooldowns;
  wages: number;
} {
  if (
    camera.status !== "contracted" || !canPerform(cooldowns, "install", now)
  ) {
    return { camera, player, cooldowns: cooldowns ?? {}, wages: 0 };
  }
  const wages = Math.round(camera.wageValue * wageMultiplier);
  return {
    camera: { ...camera, status: "active", installedBy: player.id },
    player: { ...player, currency: player.currency + wages },
    cooldowns: stampActivity(cooldowns, "install", now),
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
 * the region's dismantle refresh timer is still running.
 */
export function dismantleCamera(
  camera: Camera,
  player: Player,
  cooldowns: CameraCooldowns | undefined,
  coverage: number,
  now = Date.now(),
): { camera: Camera; player: Player; cooldowns: CameraCooldowns } {
  if (camera.status !== "active" || !canPerform(cooldowns, "dismantle", now)) {
    return { camera, player, cooldowns: cooldowns ?? {} };
  }
  const scrap = { ...player.scrap };
  for (const component of camera.scrapYield) {
    scrap[component] = (scrap[component] ?? 0) + 1;
  }
  return {
    camera: { ...camera, status: "dismantled" },
    player: {
      ...player,
      scrap,
      suspicion: player.suspicion + Math.max(
        0,
        suspicionForTakedown(coverage) - cameraTakedownReduction(player) -
          eventSuspicionReduction(player),
      ),
    },
    cooldowns: stampActivity(cooldowns, "dismantle", now),
  };
}

/** Regional coverage: active cameras per total authored camera sites (§3.6.3). */
export function coverageLevel(cameras: Camera[], region: string): number {
  const regional = cameras.filter((c) => c.region === region);
  if (regional.length === 0) return 0;
  const active = regional.filter((c) => c.status === "active").length;
  return active / regional.length;
}

/**
 * Reopen one stripped site when a region has no installation work left. This
 * keeps the core loop renewable without duplicating contracts every tick.
 */
export function renewCameraContract(
  cameras: Camera[],
  region: string,
): Camera | null {
  const regional = cameras.filter((camera) => camera.region === region);
  if (regional.some((camera) => camera.status === "contracted")) return null;
  const stripped = regional.find((camera) => camera.status === "dismantled");
  return stripped
    ? { ...stripped, status: "contracted", installedBy: null }
    : null;
}

/** Sum a player's scrapped component counts. */
export function totalScrap(player: Player): number {
  return Object.values(player.scrap).reduce((sum, n) => sum + (n ?? 0), 0);
}
