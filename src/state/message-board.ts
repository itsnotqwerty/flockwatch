import type { MessagePost } from "../types.ts";
import { openStore, type Store } from "./store.ts";

export const MAX_MESSAGE_LENGTH = 240;
const key = (regionId: string, id: string) => ["message_board", regionId, id];

export function normalizeMessageBody(body: string): string | null {
  const normalized = body.replaceAll(/\s+/g, " ").trim();
  if (!normalized || normalized.length > MAX_MESSAGE_LENGTH) return null;
  return normalized;
}

export async function saveMessagePost(
  post: MessagePost,
  s?: Store,
): Promise<void> {
  await (s ?? await openStore()).set(key(post.regionId, post.id), post);
}

export async function listMessagePosts(
  regionId: string,
  limit = 30,
  s?: Store,
): Promise<MessagePost[]> {
  const entries = await (s ?? await openStore()).list<MessagePost>([
    "message_board",
    regionId,
  ]);
  return entries.map((entry) => entry.value)
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, limit);
}
