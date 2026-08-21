import { assertEquals } from "$assert";
import type { Player, Sublocation } from "../types.ts";
import { locationSupports } from "./access.ts";

const player = {
  id: "p",
  name: "P",
  currency: 0,
  inventory: [],
  scrap: {},
  suspicion: 0,
  region: "cleveland",
  location: "mill",
  quests: [],
  flags: [],
  intel: {},
  restricted: [],
  completedLocationActions: [],
  trustedPlayerIds: [],
  lastSeenAt: "",
} satisfies Player;

const mill = {
  id: "mill",
  regionId: "cleveland",
  name: "Mill",
  description: "",
  interactions: [{
    id: "camera_board",
    label: "Cameras",
    description: "",
    kind: "cameras",
  }],
} satisfies Sublocation;

Deno.test("location capabilities require the current place and interaction", () => {
  assertEquals(locationSupports(player, mill, "cameras"), true);
  assertEquals(locationSupports(player, mill, "market"), false);
  assertEquals(
    locationSupports(player, { ...mill, id: "elsewhere" }, "cameras"),
    false,
  );
  assertEquals(
    locationSupports(player, { ...mill, regionId: "atlanta" }, "cameras"),
    false,
  );
  assertEquals(locationSupports(player, null, "cameras"), false);
});
