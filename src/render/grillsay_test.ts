import { assert, assertEquals } from "$assert";
import { loadArt, renderBubble, renderDialogue, validateWrap, wordWrap } from "./grillsay.ts";

Deno.test("wordWrap respects the 40-column width", () => {
  const lines = wordWrap("The pigeons are definitely just pigeons and nobody should count them");
  for (const line of lines) assert(line.length <= 40);
  assertEquals(lines.join(" "), "The pigeons are definitely just pigeons and nobody should count them");
});

Deno.test("renderBubble frames single lines with angle brackets", () => {
  assertEquals(renderBubble("Hello"), " _______\n< Hello >\n -------");
});

Deno.test("renderBubble frames multi-line bubbles", () => {
  const bubble = renderBubble("one two three four five six seven eight nine ten eleven");
  const lines = bubble.split("\n");
  assert(lines[0].startsWith(" _"));
  assert(lines[1].startsWith("/ "));
  assert(lines.at(-2)!.startsWith("\\ "));
  assert(lines.at(-1)!.startsWith(" -"));
});

Deno.test("loadArt returns art files and falls back safely", async () => {
  const boomer = await loadArt("boomer");
  assert(boomer.includes("\\########/"))
  const fallback = await loadArt("does_not_exist");
  assert(fallback.length > 0);
  // Path traversal attempts fall back instead of throwing.
  assertEquals(await loadArt("../../etc/passwd"), fallback);
});

Deno.test("renderDialogue stacks bubble above art", async () => {
  const out = await renderDialogue("The Forms must be filed.", "clerk");
  const [bubble, ...art] = out.split("\n");
  assert(bubble.startsWith(" _"));
  assert(art.join("\n").length > 0);
});

Deno.test("validateWrap flags unwrappable words", () => {
  assertEquals(validateWrap(["short words only"]), []);
  const issues = validateWrap(["a".repeat(41)]);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].length, 41);
});
