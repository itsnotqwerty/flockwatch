# FlockWatch Codebase Audit

Audit date: 2026-08-21

## Executive assessment

FlockWatch has a coherent playable loop and unusually broad content for its
size: 12 regions, 36 sublocations, 55 NPCs, 44 quests, 29 items, 9 recipes, and
8 encounters. Dialogue, quest progression, cameras, crafting, trading,
espionage, solo combat, cells, cooperative operations, persistence, content
validation, and regional realtime updates are all implemented.

This audit focused on whether those systems remain authoritative under direct
requests, survive process restarts and concurrent players, stay playable after
world content is consumed, and provide complete gameplay across the expanded
map. The repair pass raised the automated suite from 140 to 150 passing tests
and added full entrypoint type-checking to the verification performed during the
audit.

## Corrected in this pass

| Area                      | Finding                                                                                                                                       | Resolution                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialogue                  | Quest prerequisite and stage gates existed only in rendered options. A forged selection could bypass them.                                    | `resolveSelection` now rechecks authoritative option availability. Content validation verifies prerequisite references and stage reachability.                               |
| Route authority           | Camera, market, espionage, and boss actions could be submitted from an unrelated sublocation.                                                 | Added a shared server-side sublocation capability check and enforced it on every bound action. Boss identity, region, restriction, and encounter state are revalidated.      |
| Travel                    | Players could change location or region while a solo encounter remained active.                                                               | Travel is blocked until the encounter is finished or fled.                                                                                                                   |
| Solo combat               | Paid moves silently worked without enough credits. A total wipe left a player at 0 HP and 0 credits, creating a recovery deadlock.            | Paid moves now require funds. Wiped players wake at 25% HP while still losing credits, salvage, intel, and tradeable equipment.                                              |
| Cell combat               | Group bosses did not retaliate, apply HP damage, knock out players, or require alternating participants.                                      | Cell bosses now use enemy moves, damage and wipe participants, track knockouts, support defeat, and enforce cooperative turn order while another active member is available. |
| Shared mutations          | Two players could claim the same camera transition or market listing concurrently.                                                            | Added short atomic world-action leases around shared camera and purchase mutations.                                                                                          |
| Market persistence        | Listing IDs restarted from `lst_1` on every process boot and could overwrite unsold stock.                                                    | Listing IDs now use UUIDs.                                                                                                                                                   |
| In-memory storage         | Key segments were concatenated, allowing unrelated keys to collide; returned keys were reconstructed incorrectly; TTL was ignored.            | Keys now use the same JSON encoding as production, retain exact segments, and honor expiry.                                                                                  |
| Sessions and action posts | Server sessions outlived the 30-day browser cookie, and missing action IDs were still accepted.                                               | Sessions now carry and enforce a 30-day expiry. All gameplay POSTs require a valid one-use request ID.                                                                       |
| Camera war                | Contracted sites were excluded from coverage, so the first install could produce 100% coverage. All camera work eventually exhausted forever. | Coverage uses every authored site. A world tick renews one stripped site when a region has no open contract.                                                                 |
| Regional simulation       | Repeated ticks added fixed deltas, pushing stats to extremes based on timer frequency; prosperity and mood never reacted.                     | Stats now move by bounded steps toward camera-war equilibria. Prosperity and population mood are derived as the world changes.                                               |
| Expanded-map combat       | Only New York City had a boss after the map grew to twelve cities.                                                                            | Added Commissioner Voss, Director Pelican, and Platform Oracle K-9, giving every region a multi-phase boss. Validation now requires encounter and boss coverage per region.  |
| Interaction UX            | The client interaction script was empty.                                                                                                      | Added immediate submit feedback, double-submit prevention, and back-forward-cache recovery.                                                                                  |
| Content validation        | Duplicate IDs across separate files, invalid quest stages, unplaced NPCs, bad region references, and unlisted locations could pass.           | Cross-file validation now rejects all of these conditions. Removed one permanently unreachable dialogue option.                                                              |
| Documentation             | README, specification, and roadmap still described the original six-city game.                                                                | Updated all three to match the twelve-city map and current live-world behavior.                                                                                              |

## Remaining work, in priority order

### P0: transactional persistence

The generic `Store` interface supports atomic claim-if-absent but not a true
multi-key transaction. Short leases prevent duplicate camera and listing claims,
but a process failure between multiple writes can still partially apply a market
sale, item transfer, cell reward distribution, or account creation. The next
infrastructure milestone should add a transactional operation layer implemented
with Deno KV atomic commits and matching Postgres RPC functions.

### P0: real-backend integration tests

Pure game logic and in-memory persistence are well covered. The application
still needs HTTP-level tests for authentication, action routing, redirects,
cookies, WebSocket upgrades, and error responses, plus integration suites
against Deno KV and a disposable Postgres/Supabase instance.

### P1: route decomposition

`src/routes/play.ts` remains the main maintainability hotspot at roughly 2,500
lines. Split action families into authenticated handlers with a shared action
context, capability policy, mutation result, and response renderer. This will
make route authorization directly unit-testable instead of relying on helper
coverage and entrypoint type checks.

### P1: visible action outcomes

Several valid but unsuccessful actions redirect home without explaining why,
especially travel, crafting, patrol rolls, market races, and camera cooldown
races. A Post/Redirect/Get notice mechanism would preserve refresh safety while
showing a concise result after every action.

### P1: balance and progression telemetry

Economy values are internally plausible, but there is no simulation or live
telemetry for time-to-first-craft, regional credit supply, material scarcity,
boss completion rate, wipe recovery time, market liquidity, or quest funnel
drop-off. Add deterministic progression simulations and aggregate, anonymous
world metrics before making large balance changes.

### P2: live operations and production

The remaining roadmap items are external notifications, recurring authored
events, seasonal escalation/reset arcs, and an automated production pipeline.
These are expansion and operations work rather than blockers for the current
gameplay loop.

## Verification

- Content validation: 55 NPCs, 44 quests, 12 regions, 36 sublocations, 29 items,
  9 recipes, 8 encounters.
- Automated tests: 150 passed, 0 failed.
- Formatter: clean.
- Linter: clean.
- Full `main.ts` dependency graph: type-checks cleanly.
- Git whitespace validation: clean.
