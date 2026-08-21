import type { Npc, Quest } from "../types.ts";
import { openStore, type Store } from "./store.ts";

const npcKey = (id: string) => ["npcs", id];
const questKey = (id: string) => ["quests", id];

/** Seed content into the store, skipping ids that already exist. */
export async function seedContent(
  npcs: Npc[],
  quests: Quest[],
  s?: Store,
): Promise<void> {
  const st = s ?? await openStore();
  for (const npc of npcs) {
    if (!(await st.get(npcKey(npc.id)))) await st.set(npcKey(npc.id), npc);
  }
  for (const quest of quests) {
    if (!(await st.get(questKey(quest.id)))) {
      await st.set(questKey(quest.id), quest);
    }
  }
}

/**
 * Content schema/content version. Bump this whenever NPC or quest content
 * changes in a way that already-seeded stores must pick up. On boot, if the
 * stored version doesn't match, NPCs and quests are reseeded (overwritten).
 * Player state (quests held, inventory, currency) is never touched — only
 * the static content records.
 */
export const CONTENT_VERSION = 13;

const versionKey = ["meta", "content_version"];

/**
 * Ensure the store's content matches the shipped content. Seeds missing
 * records, and when CONTENT_VERSION has moved on, overwrites existing NPC
 * and quest records so dialogue/content fixes reach stores that were seeded
 * by an older build. Sets the stored version marker when done.
 */
export async function ensureContentCurrent(
  npcs: Npc[],
  quests: Quest[],
  s?: Store,
): Promise<boolean> {
  const st = s ?? await openStore();
  const stored = await st.get<number>(versionKey);
  if (stored === CONTENT_VERSION) return false;
  for (const npc of npcs) await st.set(npcKey(npc.id), npc);
  for (const quest of quests) await st.set(questKey(quest.id), quest);
  await st.set(versionKey, CONTENT_VERSION);
  return true;
}

export async function getNpc(id: string, s?: Store): Promise<Npc | null> {
  return (s ?? await openStore()).get<Npc>(npcKey(id));
}

export async function listNpcs(s?: Store): Promise<Npc[]> {
  const entries = await (s ?? await openStore()).list<Npc>(["npcs"]);
  return entries.map((e) => e.value);
}

export async function getQuest(id: string, s?: Store): Promise<Quest | null> {
  return (s ?? await openStore()).get<Quest>(questKey(id));
}
