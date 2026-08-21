import { assert, assertEquals } from "$assert";
import { tickRegion } from "./tick.ts";
import type { Camera, Region } from "../types.ts";

function region(overrides: Partial<Region["stats"]> = {}): Region {
  return {
    id: "cleveland",
    name: "Cleveland",
    locations: [],
    stats: {
      coverage: 0,
      unrest: 0.3,
      prosperity: 0.4,
      flockPresence: 0.7,
      populationMood: "wary",
      ...overrides,
    },
    economyProfile: { consumes: [], produces: [], wageMultiplier: 1 },
  };
}

function cam(status: Camera["status"]): Camera {
  return {
    id: `c_${status}_${Math.random()}`,
    region: "cleveland",
    status,
    installedBy: null,
    wageValue: 10,
    scrapYield: ["lens"],
  };
}

Deno.test("tick recomputes coverage from cameras", () => {
  const cams = [cam("active"), cam("active"), cam("dismantled")];
  const out = tickRegion(region(), cams);
  assertEquals(out.stats.coverage, 2 / 3);
});

Deno.test("tick drifts unrest and flockPresence within bounds", () => {
  const manyDismantled = Array.from({ length: 10 }, () => cam("dismantled"));
  const out = tickRegion(region(), manyDismantled);
  assert(out.stats.unrest > 0.3, "unrest should rise with dismantles");
  assert(out.stats.unrest <= 1);
  assert(out.stats.flockPresence < 0.7, "presence falls with dismantles");
  assert(out.stats.flockPresence >= 0);
});

Deno.test("tick ignores cameras from other regions", () => {
  const foreign = [{ ...cam("active"), region: "other" }];
  const out = tickRegion(region(), foreign);
  assertEquals(out.stats.coverage, 0);
});

Deno.test("tick changes are bounded and derive population mood", () => {
  const watched = [cam("active"), cam("active"), cam("active")];
  const out = tickRegion(
    region({ coverage: 0, unrest: 0.8, prosperity: 0.2, flockPresence: 0.2 }),
    watched,
  );
  assertEquals(out.stats.coverage, 1);
  assertEquals(out.stats.flockPresence, 0.21);
  assertEquals(out.stats.unrest, 0.79);
  assertEquals(out.stats.prosperity, 0.205);
  assertEquals(out.stats.populationMood, "defiant");
});
