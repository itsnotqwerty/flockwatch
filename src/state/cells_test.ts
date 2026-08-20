import { assert, assertEquals } from "$assert";
import {
  acceptCellInvite,
  createCell,
  getCellForPlayer,
  inviteToCell,
  leaveCell,
} from "./cells.ts";
import { createMemoryStore } from "./store.ts";

Deno.test("cells support leadership, invitations, acceptance, and succession", async () => {
  const store = createMemoryStore();
  const created = await createCell("leader", "The Bird Counters", store);
  assert(created.ok);
  const invited = await inviteToCell("leader", "member", store);
  assert(invited.ok);
  const accepted = await acceptCellInvite("member", invited.invite!.id, store);
  assertEquals(accepted.cell?.memberIds, ["leader", "member"]);
  const left = await leaveCell("leader", store);
  assertEquals(left.cell?.leaderId, "member");
  assertEquals(
    (await getCellForPlayer("member", store))?.name,
    "The Bird Counters",
  );
});

Deno.test("cell names are unique and only leaders can invite", async () => {
  const store = createMemoryStore();
  await createCell("leader", "Quiet Filing", store);
  assert(!(await createCell("other", "quiet filing", store)).ok);
  const invitation = await inviteToCell("stranger", "target", store);
  assert(!invitation.ok);
});
