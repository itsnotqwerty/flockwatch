import { assertEquals } from "$assert";
import { clearContentCache, getContent } from "./index.ts";

Deno.test("every city has 2–3 locations, 5–6 interactions, and one board", async () => {
  clearContentCache();
  const { npcs, regions, locations } = await getContent();
  assertEquals(regions.length, 12);
  assertEquals(locations.length, 36);
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
    const regionalNpcs = npcs.filter((npc) => npc.region === region.id);
    assertEquals(
      regionalNpcs.length >= 4 && regionalNpcs.length <= 5,
      true,
      region.id,
    );
    const exposedNpcIds = new Set(
      local.flatMap((location) => location.interactions)
        .flatMap((interaction) => interaction.npcIds ?? []),
    );
    assertEquals(
      regionalNpcs.every((npc) => exposedNpcIds.has(npc.id)),
      true,
      region.id,
    );
    for (
      const interaction of local.flatMap((location) => location.interactions)
    ) {
      if ((interaction.npcIds?.length ?? 0) < 2) continue;
      const namedNpcs = regionalNpcs.filter((npc) =>
        interaction.npcIds!.includes(npc.id) &&
        interaction.label.toLocaleLowerCase().includes(
          npc.name.toLocaleLowerCase(),
        )
      );
      assertEquals(
        namedNpcs.length === 0 ||
          namedNpcs.length === interaction.npcIds!.length,
        true,
        `${region.id}.${interaction.id}: a multi-NPC label must name everyone or no one`,
      );
    }
  }
});
