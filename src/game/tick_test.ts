import { assert, assertEquals } from "$assert";
import { tickRegion } from "./tick.ts";
import type { Camera, Region } from "../types.ts";

function region(overrides: Partial<Region["stats"]> = {}): Region {
  return {
    id: "rust_belt",
    name: "The Rust Belt",
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
    region: "rust_belt",
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
