import { assert, assertEquals } from "$assert";
import type { Player } from "../types.ts";
import { setTrust, shareIntel, shareItem, shareQuest } from "./multiplayer.ts";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    currency: 25,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "mill",
    quests: [],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
    ...overrides,
  };
}

Deno.test("trust gates item transfer at a shared location", () => {
  const sender = setTrust(
    player("sender", { inventory: ["binoculars"] }),
    "recipient",
    true,
  );
  const result = shareItem(sender, player("recipient"), "binoculars");
  assert(result.ok);
  assertEquals(result.sender.inventory, []);
  assertEquals(result.recipient.inventory, ["binoculars"]);
  assert(
    !shareItem(
      player("sender", { inventory: ["binoculars"] }),
      player("recipient"),
      "binoculars",
    ).ok,
  );
});

Deno.test("intel sharing copies the sender's current city dossier", () => {
  const sender = setTrust(
    player("sender", { intel: { cleveland: 4 } }),
    "recipient",
    true,
  );
  const result = shareIntel(
    sender,
    player("recipient", { intel: { cleveland: 1 } }),
  );
  assert(result.ok);
  assertEquals(result.recipient.intel.cleveland, 4);
});

Deno.test("an accepted assignment can be shared without overwriting progress", () => {
  const sender = player("sender", {
    quests: [{ questId: "pigeon_audit", status: "accepted", stageIndex: 1 }],
  });
  const result = shareQuest(sender, player("recipient"), "pigeon_audit");
  assert(result.ok);
  assertEquals(result.recipient.quests, [{
    questId: "pigeon_audit",
    status: "accepted",
    stageIndex: 1,
  }]);
  assert(!shareQuest(sender, result.recipient, "pigeon_audit").ok);
});
