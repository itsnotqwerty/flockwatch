/**
 * Test fixtures: validated content loaded from the JSON content files,
 * so tests exercise the same data the server runs.
 */
import { loadContentOrThrow } from "../content/load.ts";

export const { npcs, quests } = await loadContentOrThrow();
