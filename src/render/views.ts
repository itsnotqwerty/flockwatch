/**
 * HTML view rendering helpers (design §3.2: render/ owns presentation).
 */

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export interface PageOptions {
  title: string;
  body: string;
  locationName?: string;
}

function protectPostForms(body: string): string {
  return body.replaceAll(
    '<form method="post" action="/">',
    () =>
      `<form method="post" action="/">\n  <input type="hidden" name="request_id" value="${crypto.randomUUID()}">`,
  );
}

/** Wrap page body in the shared shell. */
export function renderPage({ title, body, locationName }: PageOptions): string {
  const locationLabel = locationName
    ? escapeHtml(locationName)
    : "Current Location";
  const protectedBody = protectPostForms(body);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — FlockWatch</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <h1>FlockWatch</h1>
  <nav>
    <a href="/">${locationLabel}</a>
    <span class="alpha-info" tabindex="0" role="note" aria-label="Alpha notice: This game is in an experimental alpha. Content may change and your playthrough may get reset.">ⓘ<span class="alpha-tooltip">This game is in an experimental alpha. Content may change and your playthrough may get reset.</span></span>
  </nav>
</header>
<main>
${protectedBody}
</main>
<footer>
  <p>© 2026 Samuel Roux · <a href="https://github.com/itsnotqwerty/flockwatch">View the code</a></p>
  <p class="donate-line">Cool Freakin' Games is funded entirely by donations <a class="donate" href="bitcoin:bc1qsxmj8euqjqqze36kweglg4kut30f95gygmhyz3">&#8383; Donate Bitcoin</a></p>
</footer>
<script src="/interactivity.js" defer></script>
<script src="/realtime.js" defer></script>
</body>
</html>`;
}

/** A grillsay bubble + art block as HTML (text stays real text, in <pre>). */
export function renderDialogueBlock(
  rendered: string,
  speakerName: string,
): string {
  return `<figure class="dialogue">
<figcaption>${escapeHtml(speakerName)}</figcaption>
<pre>${escapeHtml(rendered)}</pre>
</figure>`;
}

/** A quest-reveal notice shown after a hidden quest is assigned (spec §3.1). */
export function renderQuestReveal(
  questTitle: string,
  objective: string,
): string {
  return `<aside class="quest-reveal">
<p class="quest-reveal-title">New Assignment: ${escapeHtml(questTitle)}</p>
<p>${escapeHtml(objective)}</p>
<p class="quest-reveal-note">(This assignment was always available. You simply had not asked.)</p>
</aside>`;
}

/** A turn-in notice shown when a quest's final stage is completed. */
export function renderQuestTurnIn(
  questTitle: string,
  payout: number,
  materials = "",
): string {
  return `<aside class="quest-reveal quest-turnin">
<p class="quest-reveal-title">Assignment Filed: ${escapeHtml(questTitle)}</p>
<p>The Forms are satisfied. ${payout} credits have been disbursed to your account.</p>
${
    materials
      ? `<p>Recovered crafting materials: ${escapeHtml(materials)}.</p>`
      : ""
  }
</aside>`;
}

/** A one-shot notice shown when gameplay advances an accepted quest. */
export function renderQuestAdvance(
  questTitle: string,
  completedObjective: string,
  nextObjective: string | null,
): string {
  return `<aside class="quest-reveal quest-advance">
<p class="quest-reveal-title">Quest Advanced: ${escapeHtml(questTitle)}</p>
<p>Completed: ${escapeHtml(completedObjective)}</p>
<p><strong>${
    nextObjective
      ? `Next: ${escapeHtml(nextObjective)}`
      : "Assignment complete."
  }</strong></p>
</aside>`;
}

export function renderQuestProgressNotifications(
  notifications: Array<{
    questTitle: string;
    completedObjective: string;
    nextObjective: string | null;
  }>,
): string {
  return notifications.map((notice) =>
    renderQuestAdvance(
      notice.questTitle,
      notice.completedObjective,
      notice.nextObjective,
    )
  ).join("\n");
}

export interface QuestJournalEntry {
  id: string;
  title: string;
  status: "accepted" | "completed" | "failed";
  objective: string;
  shareable: boolean;
}

export function renderQuestJournal(entries: QuestJournalEntry[]): string {
  const renderEntries = (
    filtered: QuestJournalEntry[],
    emptyMessage: string,
  ): string =>
    filtered.length
      ? filtered.map((entry) =>
        `<li><strong>${escapeHtml(entry.title)}</strong> — ${
          escapeHtml(entry.objective)
        }${
          entry.shareable
            ? `<form method="post" action="/">
  <input type="hidden" name="a" value="share_quest">
  <input type="hidden" name="quest" value="${escapeHtml(entry.id)}">
  <button type="submit" class="link-button">Share with nearby cell</button>
</form>`
            : ""
        }</li>`
      ).join("\n")
      : `<li class="quest-log-empty">${emptyMessage}</li>`;

  const active = entries.filter((entry) => entry.status !== "completed");
  const completed = entries.filter((entry) => entry.status === "completed");
  return `<section class="quest-journal" data-tabs>
<div class="quest-tabs" role="tablist" aria-label="Quest journal">
  <button type="button" role="tab" id="active-quests-tab" aria-selected="true" aria-controls="active-quests">Active <span>${active.length}</span></button>
  <button type="button" role="tab" id="completed-quests-tab" aria-selected="false" aria-controls="completed-quests" tabindex="-1">Completed <span>${completed.length}</span></button>
</div>
<section role="tabpanel" id="active-quests" aria-labelledby="active-quests-tab">
  <ul class="quest-log">
${
    renderEntries(
      active,
      "No active assignments. You have not asked the right questions yet.",
    )
  }
  </ul>
</section>
<section role="tabpanel" id="completed-quests" aria-labelledby="completed-quests-tab" hidden>
  <ul class="quest-log">
${renderEntries(completed, "No completed assignments.")}
  </ul>
</section>
</section>`;
}

/** A generic "start the conversation over" control (next === "reset"). */
export function renderReset(npcId: string): string {
  return `<form method="post" action="/">
  <input type="hidden" name="a" value="talk">
  <input type="hidden" name="npc" value="${escapeHtml(npcId)}">
  <button type="submit" class="link-button">Start over</button>
</form>`;
}

export function renderDialogueOptions(
  npcId: string,
  nodeId: string,
  options: Array<{ id: string; label: string }>,
): string {
  const items = options
    .map(
      (o) =>
        `<li>
<form method="post" action="/">
  <input type="hidden" name="a" value="talk">
  <input type="hidden" name="npc" value="${escapeHtml(npcId)}">
  <input type="hidden" name="node" value="${escapeHtml(nodeId)}">
  <input type="hidden" name="option" value="${escapeHtml(o.id)}">
  <button type="submit" class="dialogue-option">${escapeHtml(o.label)}</button>
</form>
</li>`,
    )
    .join("\n");
  return `<ul class="dialogue-options">\n${items}\n</ul>`;
}
