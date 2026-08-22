import { assert, assertEquals } from "$assert";
import {
  renderPage,
  renderQuestJournal,
  renderQuestProgressNotifications,
  renderReset,
} from "./views.ts";

Deno.test("renderPage gives every POST form a unique action request id", () => {
  const page = renderPage({
    title: "Test",
    body: `<form method="post" action="/"></form>
<form method="post" action="/"></form>
<form method="get" action="/"></form>`,
  });
  const ids = [...page.matchAll(/name="request_id" value="([^"]+)"/g)]
    .map((match) => match[1]);
  assertEquals(ids.length, 2);
  assert(ids[0] !== ids[1]);
  assertEquals(page.match(/<form method="get"/g)?.length, 1);
});

Deno.test("renderReset restarts an NPC conversation without a node", () => {
  const control = renderReset("chi_omar");
  assert(control.includes('name="a" value="talk"'));
  assert(control.includes('name="npc" value="chi_omar"'));
  assert(!control.includes('name="node"'));
  assert(control.includes("Start over"));
});

Deno.test("quest progress notices identify the completed and next objectives", () => {
  const notice = renderQuestProgressNotifications([{
    questTitle: "The Discrepancy",
    completedObjective: "Recover the New Orleans trace.",
    nextObjective: "Craft an artifact in Seattle.",
  }]);
  assert(notice.includes("Quest Advanced: The Discrepancy"));
  assert(notice.includes("Completed: Recover the New Orleans trace."));
  assert(notice.includes("Next: Craft an artifact in Seattle."));
});

Deno.test("quest journal separates active and completed assignments", () => {
  const journal = renderQuestJournal([
    {
      id: "active_quest",
      title: "Current Business",
      status: "accepted",
      objective: "File the form.",
      shareable: true,
    },
    {
      id: "completed_quest",
      title: "Filed Business",
      status: "completed",
      objective: "Completed. The Forms thank you.",
      shareable: false,
    },
  ]);

  assert(journal.includes('id="active-quests-tab" aria-selected="true"'));
  assert(journal.includes('id="completed-quests"'));
  assert(
    journal.includes(
      'id="completed-quests" aria-labelledby="completed-quests-tab" hidden',
    ),
  );
  assert(/id="active-quests"[^]*Current Business[^]*<\/section>/.test(journal));
  assert(
    /id="completed-quests"[^]*Filed Business[^]*<\/section>/.test(journal),
  );
  assertEquals(journal.match(/name="a" value="share_quest"/g)?.length, 1);
});

Deno.test("quest journal renders empty states and escapes quest text", () => {
  const empty = renderQuestJournal([]);
  assert(empty.includes("No active assignments."));
  assert(empty.includes("No completed assignments."));

  const journal = renderQuestJournal([{
    id: "quest_1",
    title: "Forms < Birds",
    status: "failed",
    objective: 'Retry the "filing".',
    shareable: false,
  }]);
  assert(journal.includes("Forms &lt; Birds"));
  assert(journal.includes("Retry the &quot;filing&quot;."));
});
