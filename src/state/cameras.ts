import type { Camera } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const key = (id: string) => ["cameras", id];

export async function getCamera(id: string, s?: Store): Promise<Camera | null> {
  return (s ?? await openStore()).get<Camera>(key(id));
}

export async function saveCamera(camera: Camera, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(key(camera.id), camera);
}

export async function listCameras(s?: Store): Promise<Camera[]> {
  const entries = await (s ?? await openStore()).list<Camera>(["cameras"]);
  return entries.map((e) => e.value);
}

export async function camerasInRegion(
  region: string,
  s?: Store,
): Promise<Camera[]> {
  return (await listCameras(s)).filter((c) => c.region === region);
}

/** Idempotent seeding (used by tests and startup). */
export async function seedCameras(cameras: Camera[], s?: Store): Promise<void> {
  const st = s ?? await openStore();
  for (const camera of cameras) {
    if (!(await st.get(key(camera.id)))) await st.set(key(camera.id), camera);
  }
}
