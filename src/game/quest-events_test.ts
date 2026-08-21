import { assertEquals } from "$assert";
import type { Player, Quest } from "../types.ts";
import { acceptQuest, availableOptions, resolveSelection } from "./dialogue.ts";
import { npcs, quests } from "./fixtures.ts";
import { recordQuestEvent } from "./quest-events.ts";
import { advanceStage } from "./quests.ts";

const quest: Quest = {
  id: "q_case",
  title: "Case",
  hidden: true,
  trigger: { npc: "clerk", dialogueOption: "open" },
  stages: [
    {
      id: "install",
      objective: "Install in Cleveland.",
      requirement: { event: "camera.install", region: "cleveland" },
    },
    {
      id: "return",
      objective: "Return to the clerk.",
    },
  ],
  rewards: { currency: 0, items: [], materials: {} },
};

function player(): Player {
  return {
    id: "p",
    name: "Provisional",
    currency: 0,
    inventory: [],
    scrap: {},
    suspicion: 0,
    region: "cleveland",
    location: "cuyahoga_rolling_mill",
    quests: [{ questId: quest.id, status: "accepted", stageIndex: 0 }],
    flags: [],
    intel: {},
    restricted: [],
    completedLocationActions: [],
    trustedPlayerIds: [],
    lastSeenAt: "",
  };
}

Deno.test("quest events advance only a matching action in the required region", () => {
  const wrongAction = recordQuestEvent(player(), [quest], {
    type: "craft",
    region: "cleveland",
  });
  assertEquals(wrongAction.player.quests[0].stageIndex, 0);

  const wrongRegion = recordQuestEvent(player(), [quest], {
    type: "camera.install",
    region: "boston",
  });
  assertEquals(wrongRegion.player.quests[0].stageIndex, 0);

  const matched = recordQuestEvent(player(), [quest], {
    type: "camera.install",
    region: "cleveland",
  });
  assertEquals(matched.player.quests[0].stageIndex, 1);
  assertEquals(matched.advancedQuestIds, [quest.id]);
});

Deno.test("dialogue-only stages ignore gameplay events", () => {
  const atReturn = player();
  atReturn.quests[0].stageIndex = 1;
  const result = recordQuestEvent(atReturn, [quest], {
    type: "camera.install",
    region: "cleveland",
  });
  assertEquals(result.player.quests[0].stageIndex, 1);
  assertEquals(result.advancedQuestIds, []);
});

Deno.test("Cleveland onboarding awards the travel credential and opens the campaign", () => {
  const clerk = npcs.find((candidate) => candidate.id === "clerk")!;
  let current = player();
  current.quests = [];

  const intake = resolveSelection(
    clerk,
    "start",
    "report_nonexistence",
    current,
    quests,
  )!;
  current = acceptQuest(current, intake.grantedQuest!);
  current = recordQuestEvent(current, quests, {
    type: "camera.install",
    region: "cleveland",
  }).player;
  current = recordQuestEvent(current, quests, {
    type: "camera.dismantle",
    region: "cleveland",
  }).player;
  assertEquals(current.quests[0].stageIndex, 2);

  const issue = resolveSelection(
    clerk,
    "start",
    "issue_temporary_credential",
    current,
    quests,
  )!;
  current = advanceStage(current, issue.advancesQuest!).player;
  assertEquals(current.quests[0].status, "completed");
  assertEquals(current.inventory.includes("temporary_flock_credential"), true);
  assertEquals(
    availableOptions(clerk, "start", current).some((option) =>
      option.id === "open_continuity_case"
    ),
    true,
  );

  // The five dispositions stay unavailable until the last national stage.
  current = acceptQuest(
    current,
    quests.find((candidate) => candidate.id === "q_the_discrepancy")!,
  );
  assertEquals(
    availableOptions(clerk, "start", current).some((option) =>
      option.setsIdentityResolution
    ),
    false,
  );
  current.quests.find((held) => held.questId === "q_the_discrepancy")!
    .stageIndex = 11;
  assertEquals(
    availableOptions(clerk, "start", current).filter((option) =>
      option.setsIdentityResolution
    ).length,
    5,
  );
});
