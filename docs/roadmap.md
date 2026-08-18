# FlockWatch Roadmap

Phases are sequential but overlapping; items within a phase are roughly ordered. Each feature references its section in [docs/spec.md](spec.md).

## Phase 0 — Foundations *(current)*

- [x] oak server serving static views (spec §2.2–2.3)
- [x] grillsay dialogue engine integrated as submodule (spec §3.2)
- [x] Core documentation: README, spec, design guide, roadmap
- [ ] Split [main.ts](../main.ts) into the module structure from [docs/design.md](design.md) §3.2
- [ ] `types.ts` implementing the spec §4 data formats (quest, item, listing, camera, recipe, region)
- [ ] Deno KV state layer (`state/`) with in-memory fallback for tests
- [ ] Narrow permissions: split `start` into `dev` (`--allow-all`) and `start` (scoped)

## Phase 1 — Dialogue & Quests

Goal: a player can talk to an NPC and unknowingly accept a quest.

- [ ] grillsay rendering pipeline in `render/` with 40-column wrap validation (spec §3.2)
- [ ] Dialogue trees: JSON-authored NPC conversations with option triggers
- [ ] Hidden quest system: dialogue-option `questId` triggers, quest log with accepted/completed/failed states (spec §3.1)
- [ ] First NPC roster with custom grillsay art files (design §2.2)
- [ ] 3 starter quests, including "The Pigeon Audit"

## Phase 2 — Cameras System (Core Loop)

Goal: the install/takedown loop runs end-to-end in one test region.

- [ ] Camera entities with `contracted`/`active`/`dismantled` lifecycle (spec §3.6, §4.4)
- [ ] Flock installation contracts paying wages
- [ ] Takedown actions yielding scrap components (lens, housing, wiring, circuit board)
- [ ] Suspicion accrual for takedowns; basic Flock response (spec §3.6.1)
- [ ] Region coverage stat derived from active cameras (spec §3.6.3)
- [ ] Scheduled stat tick (design §3.3)

## Phase 3 — Crafting & Economy

Goal: scrap becomes items; items become a market.

- [ ] Workbench crafting from recipes (spec §3.6.2, §4.5)
- [ ] Starter recipe set: cutters, signal jammer, tradeable goods
- [ ] Player market: atomic listings, buy/sell, per-item price history (spec §3.3)
- [ ] Currency sinks and sources balanced against camera wages
- [ ] First Ministry of Valuation decree event (live-ops price modifier)

## Phase 4 — Regions

Goal: the US map exists; regional statistics and economies diverge.

- [ ] Region entities + locations, starting with 3 regions (spec §3.0, §4.6)
- [ ] Per-region stats: coverage, unrest, prosperity, Flock presence, population mood
- [ ] Per-region market instances and production/consumption profiles
- [ ] Travel between regions with time/cost
- [ ] Cross-region trade/arbitrage viability pass
- [ ] Expand to full US region set

## Phase 5 — Combat & Espionage

Goal: teeth. The world pushes back.

- [ ] Turn-based text encounter system (spec §3.4)
- [ ] Enemy roster tied to region stats (high-coverage regions spawn patrol encounters)
- [ ] Espionage actions: tailing, intercepts, intel gathering (spec §3.5)
- [ ] Espionage failure consequences: flags, restricted areas, market fees
- [ ] First multi-phase boss encounter

## Phase 6 — Multiplayer

Goal: the MMO part of the MMORPG.

- [ ] Player accounts & persistent characters
- [ ] Shared locations: see and gather with other players
- [ ] Cells (player groups) with shared quest/boss participation (spec §3.5)
- [ ] Group boss encounters and multi-stage espionage operations
- [ ] Trust mechanics: information and item sharing between players

## Phase 7 — Live World

- [ ] Twilio integration for out-of-game notifications (Flock alerts, decree announcements)
- [ ] Recurring live-ops events per region
- [ ] Seasonal camera-war resets / escalation arcs
- [ ] Deno Deploy production pipeline with scoped permissions

## Milestones

| Milestone | Phases | Definition of Done |
|-----------|--------|--------------------|
| **Playable prototype** | 0–1 | Talk to NPCs, receive hidden quests, rendered dialogue |
| **Core loop** | 2–3 | Cameras go up and down; scrap crafts into items; market works in one region |
| **The Map** | 4 | Multiple US regions with diverging stats and economies |
| **The Pushback** | 5 | Combat, espionage, and a boss |
| **The Flock** | 6–7 | Real multiplayer, live events, production deploy |
