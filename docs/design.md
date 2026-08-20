# FlockWatch Design Guide

This document is the detail style and architecture guide for FlockWatch. It
defines how the game looks, reads, and is built. For what the game is, see
[docs/spec.md](spec.md); for when features land, see
[docs/roadmap.md](roadmap.md).

## 1. Writing & Tone

### 1.1 Voice

- **Satirical bureaucratic dread, played straight.** The world is absurd; the
  writing treats it as mundane. The joke is that nobody in-world finds it funny.
- Second person for narration ("You count the pigeons. All of them."), direct
  address for NPCs.
- Deepstate entities are capitalized as proper nouns: Flock, the Agencies, the
  Ministry of Valuation, the Forms.
- Player-facing text should be short. Dialogue lines are written to wrap cleanly
  at **40 characters** (the grillsay bubble width — see spec §3.2).

### 1.2 Naming Conventions (In-World)

| Thing             | Convention                          | Examples                                                             |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------- |
| Agencies          | Singular definite-noun or acronym   | Flock, the Ministry of Valuation, OSP (Office of Suspicious Persons) |
| Quests            | Bureaucratic-euphemism titles       | "The Pigeon Audit", "Routine Wellness Inventory"                     |
| Items             | Institutional plainness with a wink | "Standard-Issue Binoculars", "Form 27-B (Blank)"                     |
| Camera components | Plain technical nouns               | lens, housing, wiring, circuit board                                 |

### 1.3 Documentation Style

- Spec = what; design (this file) = how it looks and how it's built; roadmap =
  when.
- All docs use sentence-case headings after the H1, serial commas, and en-dashes
  for ranges.
- Data examples are JSON with snake_case keys.

## 2. Visual & UI Style

### 2.1 Medium

FlockWatch is **text-first**. The UI is a reading interface, not a game engine
viewport:

- Static HTML views served by the oak server (spec §2.3), styled by
  [static/styles.css](../static/styles.css), with progressive enhancement from
  [static/interactivity.js](../static/interactivity.js).
- No client framework. Views must work with JavaScript disabled; interactivity
  layers on top.
- Dialogue renders in grillsay-style speech bubbles — monospace, box-drawn,
  40-column maximum.

### 2.2 Aesthetic Direction

- **Palette:** institutional — off-whites, filing-cabinet grays, manila,
  stamp-ink red, surveillance-green accents.
- **Type:** monospace for dialogue, terminals, and readouts; a plain grotesque
  for prose.
- **Motifs:** redaction bars, rubber stamps, CCTV frame corners, manila folder
  tabs, dot-matrix print texture.
- ASCII art (via grillsay) is the canonical character-rendering format. New NPCs
  get an art file in the style of
  [boomer.txt](../tools/grillsay/src/boomer.txt).

### 2.3 Accessibility

- Text content must be real text — ASCII art is decorative and always paired
  with accessible text alternatives.
- All interactive elements keyboard-navigable; contrast at WCAG AA minimum.

## 3. Technical Architecture

### 3.1 Stack

- **Runtime:** Deno (pinned via tasks in [deno.json](../deno.json))
- **HTTP:** oak (`jsr:@oak/oak`)
- **Views:** static HTML under `static/views/`, served per spec §2.3
- **Dialogue rendering:** grillsay submodule at
  [tools/grillsay](../tools/grillsay)
- **Persistence:** Deno KV for accounts, sessions, players, cells, encounters,
  markets, message boards, and region statistics

### 3.2 Server Structure

The server is split into modules with one-way dependencies:

```
main.ts               # bootstrap: app, router, listen
src/
├── routes/           # one module per route area (views, api, game)
├── game/             # game logic: quests, cameras, economy, regions
├── state/            # Deno KV access layer; the only module touching storage
├── realtime/         # typed regional event channels and fan-out
├── render/           # grillsay integration + view rendering helpers
└── types.ts          # shared types mirroring spec §4 data formats
```

Rules:

- `game/` contains pure logic — no oak imports, no direct storage access.
- `state/` owns all persistence; everything reads/writes through it.
- `routes/` is the only layer that knows about oak.
- `realtime/` owns ephemeral event delivery. Mutations are persisted before an
  event is published, and event payloads contain only public invalidation data.
- `/events/:region` requires a valid character session and rejects subscriptions
  outside the character's current region. HTTP actions remain authoritative;
  WebSockets do not accept game mutations.

### 3.3 World State & Ticks

- Region statistics (spec §3.0) and market prices (spec §3.3) update on a
  **scheduled tick** (Deno.cron), not per-request.
- Player actions (installs, takedowns, sales) enqueue stat deltas; the tick
  aggregates and applies them, so per-request work stays cheap and regional
  state stays consistent.

### 3.4 grillsay Integration

- The server invokes grillsay as a subprocess (`deno task grillsay` in the
  submodule) or imports its formatting logic directly; either way, `render/` is
  the only module that speaks grillsay.
- Dialogue lines pass through a wrap-check at 40 columns before rendering;
  authoring tooling should warn on overflow.

### 3.5 Permissions & Configuration

- Development runs with `--allow-all` (current `start` task). Production should
  narrow to `--allow-read` on `static/` + `tools/`, `--allow-net` on the listen
  port, `--allow-env` for declared variables.
- Secrets live in `.env.list` (gitignored). Never read env vars outside the
  bootstrap/config module.

### 3.6 Code Style

- TypeScript strict mode; interfaces for all spec §4 data formats in `types.ts`.
- Deno std library preferred over new dependencies; new deps need a
  justification note in this file.
- Formatting: `deno fmt` defaults (2-space, double quotes, semicolons).
- Naming: camelCase functions/variables, PascalCase types, SCREAMING_SNAKE for
  constants, kebab-case file names under `src/routes/`.

### 3.7 Testing

- `deno test` with std `assert`; game logic (`game/`) must be unit-testable
  without the server or storage.
- Route handlers tested via oak's testing utilities; state layer tested against
  an in-memory KV.

## 4. Content Authoring

- Quests, items, recipes, regions, and sublocations are authored as JSON
  matching spec §4 formats, validated by a schema check script before merge.
- Every region must contain two or three sublocations; every sublocation must
  contain five or six interactions; every region must expose exactly one message
  board.
- Dialogue files live alongside their NPC definitions; every option that can
  grant a quest must name its `questId` explicitly (spec §3.1).
- Regional content (markets, profiles, NPC rosters) is namespaced by region id,
  e.g. `cleveland.quests.json`.
