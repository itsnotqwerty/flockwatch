import { assert, assertEquals } from "$assert";
import {
  coverageLevel,
  createContract,
  dismantleCamera,
  installCamera,
  renewCameraContract,
  resetCameraCounter,
  suspicionForTakedown,
  totalScrap,
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

Deno.test("contract → install pays wages and activates the camera", () => {
  resetCameraCounter();
  const contract = createContract("cleveland", 100);
  assertEquals(contract.status, "contracted");
  const { camera, player, wages } = installCamera(
    contract,
    freshPlayer(),
    undefined,
    1.1,
  );
  assertEquals(camera.status, "active");
  assertEquals(camera.installedBy, "p1");
  assertEquals(wages, 110); // 100 * 1.1 multiplier
  assertEquals(player.currency, 110);
});

Deno.test("installing a non-contracted camera is a no-op", () => {
  const cam = {
    ...createContract("cleveland", 100),
    status: "active" as const,
  };
  const player = freshPlayer();
  const { player: after, wages } = installCamera(cam, player, undefined);
  assertEquals(wages, 0);
  assertEquals(after.currency, 0);
});

Deno.test("dismantling yields scrap and accrues suspicion", () => {
  const active = {
    ...createContract("cleveland", 50),
    status: "active" as const,
  };
  const { camera, player } = dismantleCamera(
    active,
    freshPlayer(),
    undefined,
    0.5,
  );
  assertEquals(camera.status, "dismantled");
  assertEquals(totalScrap(player), active.scrapYield.length);
  assertEquals(player.scrap.lens, 1);
  assertEquals(player.suspicion, suspicionForTakedown(0.5));
});

Deno.test("dismantling a non-active camera is a no-op", () => {
  const contracted = createContract("cleveland", 50);
  const player = freshPlayer();
  const { camera, player: after } = dismantleCamera(
    contracted,
    player,
    undefined,
    0.5,
  );
  assertEquals(camera.status, "contracted");
  assertEquals(totalScrap(after), 0);
  assertEquals(after.suspicion, 0);
});

Deno.test("coverage scales suspicion", () => {
  assert(suspicionForTakedown(1) > suspicionForTakedown(0));
});

Deno.test("cutters reduce camera takedown suspicion", () => {
  const active = {
    ...createContract("cleveland", 50),
    status: "active" as const,
  };
  const equipped = freshPlayer();
  equipped.inventory.push("cutters");
  const { player } = dismantleCamera(active, equipped, undefined, 0.5);
  assertEquals(player.suspicion, Math.max(0, suspicionForTakedown(0.5) - 8));
});

Deno.test("coverageLevel reflects active over total sites", () => {
  const cams = [
    { ...createContract("cleveland", 1), status: "active" as const },
    { ...createContract("cleveland", 1), status: "active" as const },
    { ...createContract("cleveland", 1), status: "dismantled" as const },
    createContract("cleveland", 1),
    { ...createContract("other", 1), status: "active" as const },
  ];
  // 2 active of 4 authored regional sites, including the open contract.
  assertEquals(coverageLevel(cams, "cleveland"), 1 / 2);
  assertEquals(coverageLevel([], "nowhere"), 0);
});

Deno.test("contract renewal reopens one stripped site only when needed", () => {
  const active = {
    ...createContract("cleveland", 1),
    status: "active" as const,
  };
  const stripped = {
    ...createContract("cleveland", 2),
    status: "dismantled" as const,
    installedBy: "p1",
  };
  const renewed = renewCameraContract([active, stripped], "cleveland")!;
  assertEquals(renewed.id, stripped.id);
  assertEquals(renewed.status, "contracted");
  assertEquals(renewed.installedBy, null);
  assertEquals(renewCameraContract([active, renewed], "cleveland"), null);
});
