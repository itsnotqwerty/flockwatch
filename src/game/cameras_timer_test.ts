import { assert, assertEquals } from "$assert";
import {
  ACTIVITY_COOLDOWNS,
  canPerform,
  cooldownRemaining,
  createContract,
  dismantleCamera,
  installCamera,
  resetCameraCounter,
  stampActivity,
} from "./cameras.ts";
import type { Player } from "../types.ts";

function freshPlayer(): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "rust_belt",
    quests: [],
  };
}

Deno.test("activities are ready with no timers", () => {
  assert(canPerform(freshPlayer(), "install"));
  assert(canPerform(freshPlayer(), "dismantle"));
});

Deno.test("stampActivity sets a cooldown that counts down", () => {
  const now = 1_000_000;
  const player = stampActivity(freshPlayer(), "install", now);
  assert(!canPerform(player, "install", now));
  const remaining = cooldownRemaining(player, "install", now);
  assertEquals(remaining, ACTIVITY_COOLDOWNS.install);
  // Ready again after the cooldown elapses.
  assert(canPerform(player, "install", now + ACTIVITY_COOLDOWNS.install));
});

Deno.test("install is blocked while on cooldown, then allowed", () => {
  resetCameraCounter();
  const now = 5_000_000;
  let player = freshPlayer();
  const c1 = createContract("rust_belt", 100);
  const first = installCamera(c1, player, 1, now);
  assert(first.wages > 0);
  player = first.player;

  // Second install immediately after is blocked by the timer.
  const c2 = createContract("rust_belt", 100);
  const blocked = installCamera(c2, player, 1, now);
  assertEquals(blocked.wages, 0);
  assertEquals(blocked.camera.status, "contracted");

  // After the cooldown, it succeeds.
  const later = installCamera(c2, player, 1, now + ACTIVITY_COOLDOWNS.install);
  assert(later.wages > 0);
  assertEquals(later.camera.status, "active");
});

Deno.test("dismantle is blocked while on cooldown", () => {
  const now = 9_000_000;
  const active = { ...createContract("rust_belt", 50), status: "active" as const };
  const first = dismantleCamera(active, freshPlayer(), 0, now);
  assertEquals(first.camera.status, "dismantled");

  const active2 = { ...createContract("rust_belt", 50), status: "active" as const };
  const blocked = dismantleCamera(active2, first.player, 0, now);
  assertEquals(blocked.camera.status, "active"); // unchanged
  assertEquals(blocked.player.suspicion, first.player.suspicion); // no extra suspicion
});

Deno.test("install and dismantle timers are independent", () => {
  const now = 3_000_000;
  const player = stampActivity(freshPlayer(), "install", now);
  assert(!canPerform(player, "install", now));
  assert(canPerform(player, "dismantle", now));
});
