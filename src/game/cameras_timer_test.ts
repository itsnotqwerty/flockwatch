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
import type { CameraCooldowns, Player } from "../types.ts";

function freshPlayer(id = "p1"): Player {
  return {
    id,
    name: "Citizen",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "cuyahoga_rolling_mill",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
  };
}

Deno.test("activities are ready with no cooldowns", () => {
  assert(canPerform(undefined, "install"));
  assert(canPerform({}, "dismantle"));
});

Deno.test("stampActivity sets a cooldown that counts down", () => {
  const now = 1_000_000;
  const cooldowns = stampActivity({}, "install", now);
  assert(!canPerform(cooldowns, "install", now));
  const remaining = cooldownRemaining(cooldowns, "install", now);
  assertEquals(remaining, ACTIVITY_COOLDOWNS.install);
  // Ready again after the cooldown elapses.
  assert(canPerform(cooldowns, "install", now + ACTIVITY_COOLDOWNS.install));
});

Deno.test("install is blocked while on cooldown, then allowed", () => {
  resetCameraCounter();
  const now = 5_000_000;
  const c1 = createContract("cleveland", 100);
  const first = installCamera(c1, freshPlayer(), {}, 1, now);
  assert(first.wages > 0);

  // Second install immediately after is blocked by the region timer.
  const c2 = createContract("cleveland", 100);
  const blocked = installCamera(c2, first.player, first.cooldowns, 1, now);
  assertEquals(blocked.wages, 0);
  assertEquals(blocked.camera.status, "contracted");

  // After the cooldown, it succeeds.
  const later = installCamera(
    c2,
    first.player,
    first.cooldowns,
    1,
    now + ACTIVITY_COOLDOWNS.install,
  );
  assert(later.wages > 0);
  assertEquals(later.camera.status, "active");
});

Deno.test("dismantle is blocked while on cooldown", () => {
  const now = 9_000_000;
  const active = {
    ...createContract("cleveland", 50),
    status: "active" as const,
  };
  const first = dismantleCamera(active, freshPlayer(), {}, 0, now);
  assertEquals(first.camera.status, "dismantled");

  const active2 = {
    ...createContract("cleveland", 50),
    status: "active" as const,
  };
  const blocked = dismantleCamera(
    active2,
    freshPlayer(),
    first.cooldowns,
    0,
    now,
  );
  assertEquals(blocked.camera.status, "active"); // unchanged
  assertEquals(blocked.player.suspicion, 0); // no extra suspicion
});

Deno.test("install and dismantle cooldowns are independent", () => {
  const now = 3_000_000;
  const cooldowns = stampActivity({}, "install", now);
  assert(!canPerform(cooldowns, "install", now));
  assert(canPerform(cooldowns, "dismantle", now));
});

Deno.test("region cooldown gates ALL players, not just the installer", () => {
  resetCameraCounter();
  const now = 4_000_000;
  // Player A installs, putting the region on install cooldown.
  const first = installCamera(
    createContract("cleveland", 100),
    freshPlayer("pA"),
    {},
    1,
    now,
  );
  assert(first.wages > 0);

  // Player B — a different player entirely — is also blocked.
  const other = installCamera(
    createContract("cleveland", 100),
    freshPlayer("pB"),
    first.cooldowns,
    1,
    now,
  );
  assertEquals(other.wages, 0);
  assertEquals(other.camera.status, "contracted");
});

Deno.test("region cooldowns are per-region state — another region is unaffected", () => {
  const now = 7_000_000;
  const rustBelt: CameraCooldowns = stampActivity({}, "install", now);
  const newYork: CameraCooldowns = {}; // separate region record
  assert(!canPerform(rustBelt, "install", now));
  assert(canPerform(newYork, "install", now));
});
