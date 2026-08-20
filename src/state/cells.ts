import type { Cell, CellInvite } from "../types.ts";
import { openStore, type Store } from "./store.ts";

export const MAX_CELL_NAME_LENGTH = 32;
const cellKey = (id: string) => ["cells", id];
const inviteKey = (
  inviteeId: string,
  id: string,
) => ["cell_invites", inviteeId, id];

export function normalizeCellName(input: string): string | null {
  const name = input.replaceAll(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > MAX_CELL_NAME_LENGTH) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N} _'&.-]*$/u.test(name) ? name : null;
}

export async function getCell(id: string, s?: Store): Promise<Cell | null> {
  return (s ?? await openStore()).get<Cell>(cellKey(id));
}

export async function saveCell(cell: Cell, s?: Store): Promise<void> {
  await (s ?? await openStore()).set(cellKey(cell.id), cell);
}

export async function listCells(s?: Store): Promise<Cell[]> {
  const entries = await (s ?? await openStore()).list<Cell>(["cells"]);
  return entries.map((entry) => entry.value);
}

export async function getCellForPlayer(
  playerId: string,
  s?: Store,
): Promise<Cell | null> {
  return (await listCells(s)).find((cell) =>
    cell.memberIds.includes(playerId)
  ) ?? null;
}

export interface CellResult {
  ok: boolean;
  reason: string | null;
  cell: Cell | null;
}

export async function createCell(
  leaderId: string,
  requestedName: string,
  s?: Store,
): Promise<CellResult> {
  const store = s ?? await openStore();
  const name = normalizeCellName(requestedName);
  if (!name) {
    return {
      ok: false,
      reason:
        `Cell names must contain 2–${MAX_CELL_NAME_LENGTH} safe characters.`,
      cell: null,
    };
  }
  if (await getCellForPlayer(leaderId, store)) {
    return { ok: false, reason: "You already belong to a cell.", cell: null };
  }
  if (
    (await listCells(store)).some((cell) =>
      cell.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
    )
  ) {
    return {
      ok: false,
      reason: "That cell name is already in circulation.",
      cell: null,
    };
  }
  const cell: Cell = {
    id: `cell_${crypto.randomUUID()}`,
    name,
    leaderId,
    memberIds: [leaderId],
    createdAt: new Date().toISOString(),
  };
  await saveCell(cell, store);
  return { ok: true, reason: null, cell };
}

export async function listCellInvites(
  inviteeId: string,
  s?: Store,
): Promise<CellInvite[]> {
  const entries = await (s ?? await openStore()).list<CellInvite>([
    "cell_invites",
    inviteeId,
  ]);
  return entries.map((entry) => entry.value);
}

export interface CellInviteResult extends CellResult {
  invite: CellInvite | null;
}

export async function inviteToCell(
  inviterId: string,
  inviteeId: string,
  s?: Store,
): Promise<CellInviteResult> {
  const store = s ?? await openStore();
  const cell = await getCellForPlayer(inviterId, store);
  if (!cell || cell.leaderId !== inviterId) {
    return {
      ok: false,
      reason: "Only a cell leader may issue invitations.",
      cell,
      invite: null,
    };
  }
  if (inviterId === inviteeId || await getCellForPlayer(inviteeId, store)) {
    return {
      ok: false,
      reason: "That citizen already belongs to a cell.",
      cell,
      invite: null,
    };
  }
  const existing = (await listCellInvites(inviteeId, store)).find((invite) =>
    invite.cellId === cell.id
  );
  if (existing) {
    return {
      ok: false,
      reason: "An invitation is already pending.",
      cell,
      invite: existing,
    };
  }
  const invite: CellInvite = {
    id: `invite_${crypto.randomUUID()}`,
    cellId: cell.id,
    inviterId,
    inviteeId,
    createdAt: new Date().toISOString(),
  };
  await store.set(inviteKey(inviteeId, invite.id), invite);
  return { ok: true, reason: null, cell, invite };
}

export async function acceptCellInvite(
  inviteeId: string,
  inviteId: string,
  s?: Store,
): Promise<CellResult> {
  const store = s ?? await openStore();
  if (await getCellForPlayer(inviteeId, store)) {
    return {
      ok: false,
      reason: "Leave your current cell before accepting another invitation.",
      cell: null,
    };
  }
  const invite = await store.get<CellInvite>(inviteKey(inviteeId, inviteId));
  if (!invite) {
    return {
      ok: false,
      reason: "That invitation is no longer on file.",
      cell: null,
    };
  }
  const cell = await getCell(invite.cellId, store);
  if (!cell) {
    return { ok: false, reason: "That cell no longer exists.", cell: null };
  }
  const updated = { ...cell, memberIds: [...cell.memberIds, inviteeId] };
  await saveCell(updated, store);
  await store.delete(inviteKey(inviteeId, inviteId));
  return { ok: true, reason: null, cell: updated };
}

export async function declineCellInvite(
  inviteeId: string,
  inviteId: string,
  s?: Store,
): Promise<boolean> {
  const store = s ?? await openStore();
  const invite = await store.get<CellInvite>(inviteKey(inviteeId, inviteId));
  if (!invite) return false;
  await store.delete(inviteKey(inviteeId, inviteId));
  return true;
}

export async function leaveCell(
  playerId: string,
  s?: Store,
): Promise<CellResult> {
  const store = s ?? await openStore();
  const cell = await getCellForPlayer(playerId, store);
  if (!cell) {
    return { ok: false, reason: "You do not belong to a cell.", cell: null };
  }
  const memberIds = cell.memberIds.filter((id) => id !== playerId);
  if (memberIds.length === 0) {
    await store.delete(cellKey(cell.id));
    const invitations = await store.list<CellInvite>(["cell_invites"]);
    for (const { value } of invitations) {
      if (value.cellId === cell.id) {
        await store.delete(inviteKey(value.inviteeId, value.id));
      }
    }
    return { ok: true, reason: null, cell: null };
  }
  const updated = {
    ...cell,
    leaderId: cell.leaderId === playerId ? memberIds[0] : cell.leaderId,
    memberIds,
  };
  await saveCell(updated, store);
  return { ok: true, reason: null, cell: updated };
}
