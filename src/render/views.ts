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
export function renderQuestTurnIn(questTitle: string, payout: number): string {
  return `<aside class="quest-reveal quest-turnin">
<p class="quest-reveal-title">Assignment Filed: ${escapeHtml(questTitle)}</p>
<p>The Forms are satisfied. ${payout} credits have been disbursed to your account.</p>
</aside>`;
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
