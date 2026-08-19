import type { Region } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["regions", id];

export async function getRegion(id: string, s?: Store): Promise<Region | null> {
  return (s ?? await openStore()).get<Region>(key(id));
}

export async function saveRegion(region: Region, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(region.id), region);
}

export async function listRegions(s?: Store): Promise<Region[]> {
  const entries = await (s ?? await openStore()).list<Region>(["regions"]);
  return entries.map((e) => e.value);
}

/** Idempotent seeding. */
export async function seedRegions(regions: Region[], s?: Store): Promise<void> {
  const st = s ?? await openStore();
  for (const region of regions) {
    if (!(await st.get(key(region.id)))) await st.set(key(region.id), region);
  }
}
