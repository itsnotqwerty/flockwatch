import { openStore, type Store } from "./store.ts";

export const POST_COOLDOWN_MS = 5_000;
export const SPAM_WINDOW_MS = 60_000;
export const MAX_ATTEMPTS_PER_WINDOW = 5;
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

export type MessageModerationReason = "spam" | "slur" | "threat";

export type MessageModerationDecision =
  | { allowed: true }
  | {
    allowed: false;
    reason: MessageModerationReason;
    message: string;
  };

interface AcceptedMessage {
  body: string;
  postedAt: number;
}

interface MessageModerationState {
  attempts: number[];
  accepted: AcceptedMessage[];
}

const stateKey = (playerId: string) => ["message_board_moderation", playerId];

// These are intentionally high-confidence terms rather than a general
// profanity list. Ordinary swearing is permitted on regional boards.
const BLOCKED_SLURS = new Set([
  "chink",
  "chinks",
  "fag",
  "faggot",
  "faggots",
  "gook",
  "gooks",
  "kike",
  "kikes",
  "nigga",
  "niggas",
  "nigger",
  "niggers",
  "raghead",
  "ragheads",
  "spic",
  "spics",
  "tranny",
  "trannies",
  "wetback",
  "wetbacks",
]);

const DIRECT_THREAT_PATTERNS = [
  /\b(?:i|we)\s+(?:will|shall|am going to|are going to|gonna|plan to)\s+(?:kill|murder|shoot|stab|attack|hurt)\s+(?:you|him|her|them|everyone|somebody|someone)\b/u,
  /\b(?:kill|murder|shoot|stab|attack|hurt)\s+(?:you|him|her|them|yourself|yourselves)\b/u,
  /\b(?:you|he|she|they)\s+(?:will|should|deserve to|need to)\s+die\b/u,
  /\b(?:bomb|shoot up|burn down)\s+(?:the\s+)?(?:school|church|mosque|synagogue|station|office|building|city hall)\b/u,
];

function canonicalize(body: string): string {
  return body.normalize("NFKC").toLocaleLowerCase()
    .replaceAll("@", "a")
    .replaceAll("$", "s")
    .replaceAll("0", "o")
    .replaceAll(/[1!|]/g, "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");
}

function containsSlur(body: string): boolean {
  const words = canonicalize(body).match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.some((word) => BLOCKED_SLURS.has(word));
}

function containsThreat(body: string): boolean {
  const normalized = canonicalize(body).replaceAll(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
  return DIRECT_THREAT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeContentSpam(body: string): boolean {
  const urls = body.match(/(?:https?:\/\/|www\.)\S+/giu) ?? [];
  if (urls.length > 2) return true;
  if (/(.)\1{11,}/iu.test(body)) return true;

  const words = canonicalize(body).match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let index = 4; index < words.length; index++) {
    const repeated = words.slice(index - 4, index + 1);
    if (repeated.every((word) => word === repeated[0])) return true;
  }
  return false;
}

export function screenMessageContent(body: string): MessageModerationDecision {
  if (containsSlur(body)) {
    return {
      allowed: false,
      reason: "slur",
      message: "That notice contains a prohibited slur.",
    };
  }
  if (containsThreat(body)) {
    return {
      allowed: false,
      reason: "threat",
      message: "Direct threats are not permitted on regional boards.",
    };
  }
  if (looksLikeContentSpam(body)) {
    return {
      allowed: false,
      reason: "spam",
      message: "That notice looks like spam.",
    };
  }
  return { allowed: true };
}

export async function moderateMessagePost(
  playerId: string,
  body: string,
  now = Date.now(),
  s?: Store,
): Promise<MessageModerationDecision> {
  const store = s ?? await openStore();
  const previous =
    await store.get<MessageModerationState>(stateKey(playerId)) ?? {
      attempts: [],
      accepted: [],
    };
  const attempts = previous.attempts.filter((at) => now - at < SPAM_WINDOW_MS);
  const accepted = previous.accepted.filter((post) =>
    now - post.postedAt < DUPLICATE_WINDOW_MS
  );
  const normalizedBody = canonicalize(body).replaceAll(/\s+/g, " ").trim();

  let decision = screenMessageContent(body);
  if (
    decision.allowed && attempts.at(-1) !== undefined &&
    now - attempts.at(-1)! < POST_COOLDOWN_MS
  ) {
    decision = {
      allowed: false,
      reason: "spam",
      message: "Please wait a few seconds before posting again.",
    };
  }
  if (decision.allowed && attempts.length >= MAX_ATTEMPTS_PER_WINDOW) {
    decision = {
      allowed: false,
      reason: "spam",
      message: "Too many notices were submitted. Try again in a minute.",
    };
  }
  if (
    decision.allowed &&
    accepted.some((post) => post.body === normalizedBody)
  ) {
    decision = {
      allowed: false,
      reason: "spam",
      message: "Duplicate notices are not permitted.",
    };
  }

  attempts.push(now);
  if (decision.allowed) accepted.push({ body: normalizedBody, postedAt: now });
  await store.set(stateKey(playerId), { attempts, accepted });
  return decision;
}
