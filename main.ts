import { Application } from "oak";
import { viewsRouter } from "./src/routes/views.ts";
import { playRouter } from "./src/routes/play.ts";
import { CONTENT_VERSION, ensureContentCurrent } from "./src/state/content.ts";
import { seedRegions } from "./src/state/regions.ts";
import { camerasInRegion, listCameras, seedCameras } from "./src/state/cameras.ts";
import { listRegions, saveRegion } from "./src/state/regions.ts";
import { makeContract } from "./src/game/cameras.ts";
import { tickAllRegions } from "./src/game/tick.ts";
import { getContent } from "./src/content/index.ts";

const PORT = Deno.env.get("PORT") ? Number(Deno.env.get("PORT")) : 8000;

const { npcs, quests, regions } = await getContent();
// Seeds missing content and overwrites stale records when CONTENT_VERSION
// has moved on, so content fixes reach already-seeded stores.
if (await ensureContentCurrent(npcs, quests)) {
  console.log(`Content updated to version ${CONTENT_VERSION}`);
}
await seedRegions(regions);

// Offer installation contracts in every region (spec §3.6). Seeding is
// per-region and idempotent (stable ids), so regions added later — or an
// existing store that only ever seeded rust_belt — still get contracts.
const CONTRACT_WAGES: Record<string, number[]> = {
  rust_belt: [85, 60, 120],
  gulf_coast: [100, 140, 90],
  pacific_northwest: [70, 55, 110],
  atlanta: [130, 95, 160, 110],
  silicon_valley: [180, 220],
  new_york: [150, 200, 175, 125, 240],
};
for (const region of regions) {
  if ((await camerasInRegion(region.id)).length > 0) continue;
  const wages = CONTRACT_WAGES[region.id] ?? [75, 60, 90];
  await seedCameras(
    wages.map((w, i) => makeContract(`cam_${region.id}_${i + 1}`, region.id, w)),
  );
}

const app = new Application();

app.use(playRouter.routes());
app.use(viewsRouter.routes());
app.use(playRouter.allowedMethods());
app.use(viewsRouter.allowedMethods());
app.use(async (context, next) => {
    const root = "./static";
    try { await context.send({ root }); } catch { await next(); }
});

// Scheduled stat tick (design §3.3): recompute regional stats from cameras.
async function tick(): Promise<void> {
  const cams = await listCameras();
  const updated = tickAllRegions(await listRegions(), cams);
  for (const region of updated) await saveRegion(region);
}
const TICK_MS = Number(Deno.env.get("TICK_MS") ?? 60_000);
setInterval(() => tick().catch((e) => console.error("tick failed:", e)), TICK_MS);

app.listen({ port: PORT });
console.log(`Server is running on http://localhost:${PORT}`);