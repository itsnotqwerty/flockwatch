import { assert, assertEquals } from "$assert";
import {
  coverageLevel,
  createContract,
  dismantleCamera,
  installCamera,
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
    region: "rust_belt",
    quests: [],
  };
}

Deno.test("contract → install pays wages and activates the camera", () => {
  resetCameraCounter();
  const contract = createContract("rust_belt", 100);
  assertEquals(contract.status, "contracted");
  const { camera, player, wages } = installCamera(contract, freshPlayer(), 1.1);
  assertEquals(camera.status, "active");
  assertEquals(camera.installedBy, "p1");
  assertEquals(wages, 110); // 100 * 1.1 multiplier
  assertEquals(player.currency, 110);
});

Deno.test("installing a non-contracted camera is a no-op", () => {
  const cam = { ...createContract("rust_belt", 100), status: "active" as const };
  const player = freshPlayer();
  const { player: after, wages } = installCamera(cam, player);
  assertEquals(wages, 0);
  assertEquals(after.currency, 0);
});

Deno.test("dismantling yields scrap and accrues suspicion", () => {
  const active = { ...createContract("rust_belt", 50), status: "active" as const };
  const { camera, player } = dismantleCamera(active, freshPlayer(), 0.5);
  assertEquals(camera.status, "dismantled");
  assertEquals(totalScrap(player), active.scrapYield.length);
  assertEquals(player.scrap.lens, 1);
  assertEquals(player.suspicion, suspicionForTakedown(0.5));
});

Deno.test("dismantling a non-active camera is a no-op", () => {
  const contracted = createContract("rust_belt", 50);
  const player = freshPlayer();
  const { camera, player: after } = dismantleCamera(contracted, player, 0.5);
  assertEquals(camera.status, "contracted");
  assertEquals(totalScrap(after), 0);
  assertEquals(after.suspicion, 0);
});

Deno.test("coverage scales suspicion", () => {
  assert(suspicionForTakedown(1) > suspicionForTakedown(0));
});

Deno.test("coverageLevel reflects active over total sites", () => {
  const cams = [
    { ...createContract("rust_belt", 1), status: "active" as const },
    { ...createContract("rust_belt", 1), status: "active" as const },
    { ...createContract("rust_belt", 1), status: "dismantled" as const },
    { ...createContract("other", 1), status: "active" as const },
  ];
  // 2 active of 3 regional sites (contracted sites excluded).
  assertEquals(coverageLevel(cams, "rust_belt"), 2 / 3);
  assertEquals(coverageLevel([], "nowhere"), 0);
});
