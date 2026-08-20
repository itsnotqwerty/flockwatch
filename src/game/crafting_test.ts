import { assert, assertEquals } from "$assert";
import { canCraft, craft, CRAFT_FEE, describeCost } from "./crafting.ts";
import type { CraftingRecipe, Player } from "../types.ts";

const jammer: CraftingRecipe = {
  id: "recipe_signal_jammer",
  result: "signal_jammer",
  components: { circuit_board: 2, wiring: 3 },
  workbench: true,
};

function player(scrap: Player["scrap"], currency = 100): Player {
  return {
    id: "p1",
    name: "Citizen",
    currency,
    inventory: [],
    scrap,
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

Deno.test("canCraft reflects component availability", () => {
  assert(canCraft(player({ circuit_board: 2, wiring: 3 }), jammer));
  assert(!canCraft(player({ circuit_board: 2, wiring: 2 }), jammer));
  assert(!canCraft(player({}), jammer));
});

Deno.test("craft consumes components, charges the licensing fee, and yields the item", () => {
  const { player: after, crafted, reason } = craft(
    player({ circuit_board: 3, wiring: 5, lens: 1 }),
    jammer,
  );
  assertEquals(crafted, "signal_jammer");
  assertEquals(reason, null);
  assertEquals(after.scrap.circuit_board, 1);
  assertEquals(after.scrap.wiring, 2);
  assertEquals(after.scrap.lens, 1); // untouched
  assertEquals(after.currency, 100 - CRAFT_FEE);
  assert(after.inventory.includes("signal_jammer"));
});

Deno.test("craft fails cleanly without components", () => {
  const before = player({ wiring: 1 });
  const { player: after, crafted, reason } = craft(before, jammer);
  assertEquals(crafted, null);
  assertEquals(reason, "Missing components.");
  assertEquals(after, before); // unchanged
});

Deno.test("craft fails cleanly without the licensing fee", () => {
  const before = player({ circuit_board: 2, wiring: 3 }, 0);
  const { player: after, crafted, reason } = craft(before, jammer);
  assertEquals(crafted, null);
  assertEquals(reason, `Workbench licensing fee is ${CRAFT_FEE}cr.`);
  assertEquals(after, before);
});

Deno.test("describeCost formats the component list", () => {
  assertEquals(describeCost(jammer), "2 circuit_board, 3 wiring");
});
