import { assert, assertEquals } from "$assert";
import { CRAFTING_MATERIALS } from "../types.ts";
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

Deno.test("crafting materials are useful and supplied by every game loop", async () => {
  clearContentCache();
  const { quests, regions, locations, items, recipes, encounters } =
    await getContent();
  const used = new Set(
    recipes.flatMap((recipe) => Object.keys(recipe.components)),
  );
  const supplied = new Set([
    ...quests.flatMap((quest) => Object.keys(quest.rewards.materials)),
    ...encounters.flatMap((encounter) => Object.keys(encounter.materialDrops)),
    ...locations.flatMap((location) =>
      location.interactions.flatMap((interaction) =>
        Object.keys(interaction.effect?.scrap ?? {})
      )
    ),
  ]);

  for (const material of CRAFTING_MATERIALS) {
    assert(used.has(material), `${material} has no recipe use`);
    assert(supplied.has(material), `${material} has no reward source`);
  }
  assert(quests.every((quest) => Object.keys(quest.rewards.materials).length));
  assert(
    encounters.every((encounter) =>
      Object.keys(encounter.materialDrops).length
    ),
  );
  assert(
    regions.every((region) =>
      locations.some((location) =>
        location.regionId === region.id &&
        location.interactions.some((interaction) =>
          Object.keys(interaction.effect?.scrap ?? {}).length
        )
      )
    ),
    "every region should expose environmental materials",
  );
  const itemIds = new Set(items.map((item) => item.id));
  assert(recipes.every((recipe) => itemIds.has(recipe.result)));
});

Deno.test("Los Angeles patrol pool includes boomers and schizos", async () => {
  clearContentCache();
  const { encounters } = await getContent();
  const losAngelesPatrolIds = encounters
    .filter((encounter) =>
      encounter.kind === "patrol" && encounter.regions.includes("los_angeles")
    )
    .map((encounter) => encounter.id);
  assert(losAngelesPatrolIds.includes("patrol_boomer"));
  assert(losAngelesPatrolIds.includes("patrol_schizo"));
});
