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
    if (!(await st.get(questKey(quest.id)))) await st.set(questKey(quest.id), quest);
  }
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
