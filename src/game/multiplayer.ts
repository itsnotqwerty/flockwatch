import type { Player, PlayerQuest } from "../types.ts";

export function setTrust(
  player: Player,
  targetId: string,
  trusted: boolean,
): Player {
  if (!targetId || targetId === player.id) return player;
  const ids = new Set(player.trustedPlayerIds);
  if (trusted) ids.add(targetId);
  else ids.delete(targetId);
  return { ...player, trustedPlayerIds: [...ids] };
}

function canShare(sender: Player, recipient: Player): string | null {
  if (sender.id === recipient.id) {
    return "You already possess your own confidence.";
  }
  if (!sender.trustedPlayerIds.includes(recipient.id)) {
    return "That citizen is not trusted for sharing.";
  }
  if (
    sender.region !== recipient.region || sender.location !== recipient.location
  ) {
    return "Both citizens must be in the same location.";
  }
  return null;
}

export interface ShareResult {
  ok: boolean;
  reason: string | null;
  sender: Player;
  recipient: Player;
}

export function shareItem(
  sender: Player,
  recipient: Player,
  itemId: string,
): ShareResult {
  const denied = canShare(sender, recipient);
  if (denied) return { ok: false, reason: denied, sender, recipient };
  const index = sender.inventory.indexOf(itemId);
  if (index < 0) {
    return {
      ok: false,
      reason: "You do not hold that item.",
      sender,
      recipient,
    };
  }
  const inventory = [...sender.inventory];
  inventory.splice(index, 1);
  return {
    ok: true,
    reason: null,
    sender: { ...sender, inventory },
    recipient: { ...recipient, inventory: [...recipient.inventory, itemId] },
  };
}

export function shareIntel(sender: Player, recipient: Player): ShareResult {
  const denied = canShare(sender, recipient);
  if (denied) return { ok: false, reason: denied, sender, recipient };
  const available = sender.intel[sender.region] ?? 0;
  if (available <= 0) {
    return {
      ok: false,
      reason: "You have no local intel to share.",
      sender,
      recipient,
    };
  }
  return {
    ok: true,
    reason: null,
    sender,
    recipient: {
      ...recipient,
      intel: {
        ...recipient.intel,
        [sender.region]: Math.max(
          recipient.intel[sender.region] ?? 0,
          available,
        ),
      },
    },
  };
}

/**
 * Copy an accepted assignment into a nearby cell member's log. Existing
 * progress is never overwritten, and completed/failed work cannot be shared.
 */
export function shareQuest(
  sender: Player,
  recipient: Player,
  questId: string,
): ShareResult {
  if (
    sender.id === recipient.id || sender.region !== recipient.region ||
    sender.location !== recipient.location
  ) {
    return {
      ok: false,
      reason:
        "Cell members must be in the same location to share an assignment.",
      sender,
      recipient,
    };
  }
  const held = sender.quests.find((quest) => quest.questId === questId);
  if (!held || held.status !== "accepted") {
    return {
      ok: false,
      reason: "Only an active assignment can be shared.",
      sender,
      recipient,
    };
  }
  if (recipient.quests.some((quest) => quest.questId === questId)) {
    return {
      ok: false,
      reason: "That citizen already has this assignment on file.",
      sender,
      recipient,
    };
  }
  const shared: PlayerQuest = { ...held };
  return {
    ok: true,
    reason: null,
    sender,
    recipient: { ...recipient, quests: [...recipient.quests, shared] },
  };
}
