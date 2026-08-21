/**
 * grillsay rendering pipeline (design §3.4). This module is the only part of
 * the app that speaks grillsay: it reimplements the word-wrap + bubble logic
 * from tools/grillsay/src/main.ts and loads character art from
 * tools/grillsay/art/ (falling back to the classic boomer).
 */

export const MAX_WIDTH = 40;

const ART_DIR = new URL("../content/art/", import.meta.url);
// Classic boomer fallback lives in the grillsay submodule.
const FALLBACK_ART = new URL(
  "../content/art/boomer.txt",
  import.meta.url,
);

export function wordWrap(text: string, width: number = MAX_WIDTH): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + (current ? 1 : 0) > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Render a message into a grillsay speech bubble (40-column wrap). */
export function renderBubble(message: string): string {
  const lines = message
    .split("\n")
    .flatMap((line) => wordWrap(line.trim(), MAX_WIDTH));
  if (lines.length === 0) return "";
  const boxWidth = Math.max(...lines.map((l) => l.length));
  const top = ` ${"_".repeat(boxWidth + 2)}`;
  const bottom = ` ${"-".repeat(boxWidth + 2)}`;
  const body = lines.map((line, i) => {
    const padded = line.padEnd(boxWidth);
    if (lines.length === 1) return `< ${padded} >`;
    if (i === 0) return `/ ${padded} \\`;
    if (i === lines.length - 1) return `\\ ${padded} /`;
    return `| ${padded} |`;
  });
  return [top, ...body, bottom].join("\n");
}

/** Load character art by file name (without extension). */
export async function loadArt(name: string): Promise<string> {
  if (!/^[a-z0-9_-]+$/.test(name)) return Deno.readTextFile(FALLBACK_ART);
  try {
    return await Deno.readTextFile(new URL(`${name}.txt`, ART_DIR));
  } catch {
    return Deno.readTextFile(FALLBACK_ART);
  }
}

/** Full grillsay render: speech bubble above character art. */
export async function renderDialogue(
  message: string,
  art = "boomer",
): Promise<string> {
  return `${renderBubble(message)}\n${await loadArt(art)}`;
}

export interface WrapIssue {
  text: string;
  length: number;
}

/**
 * Authoring validation: find words that can never fit the bubble width.
 * Individual words longer than 40 characters are an authoring error.
 */
export function validateWrap(messages: string[]): WrapIssue[] {
  const issues: WrapIssue[] = [];
  for (const message of messages) {
    for (const word of message.split(/\s+/)) {
      if (word.length > MAX_WIDTH) {
        issues.push({ text: word, length: word.length });
      }
    }
  }
  return issues;
}
