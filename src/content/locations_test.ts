import { assertEquals } from "$assert";
import { clearContentCache, getContent } from "./index.ts";

Deno.test("every city has 2–3 locations, five interactions each, and one board", async () => {
  clearContentCache();
  const { regions, locations } = await getContent();
  assertEquals(regions.length, 6);
  assertEquals(locations.length, 18);
  for (const region of regions) {
    const local = locations.filter((location) =>
      location.regionId === region.id
    );
    assertEquals(local.length >= 2 && local.length <= 3, true, region.id);
    assertEquals(
      local.every((location) =>
        location.interactions.length >= 5 && location.interactions.length <= 6
      ),
      true,
      region.id,
    );
    const boards = local.flatMap((location) => location.interactions)
      .filter((interaction) => interaction.kind === "message_board");
    assertEquals(boards.length, 1, region.id);
  }
});
