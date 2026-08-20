# FlockWatch

FlockWatch is a satirical text-based MMORPG about contending with the dystopian
deepstate.

The Agencies are watching. The Forms must be filed. The pigeons are definitely
just pigeons. Navigate a world of bureaucratic menace, quiet surveillance, and
extremely suspicious wildlife — armed with nothing but dialogue choices, a
market stall, and a healthy distrust of anyone wearing a lanyard.

## Gameplay

Gameplay elements involve talking to NPCs, receiving and completing quests,
collecting items, trading items on the market, fighting enemies and bosses,
performing espionage, gathering with friends, and much more. The game is
designed to be a cohesive and thematic world within itself.

### Quests

Quests are not usually presented to the player as "marked." They are usually
hidden behind dialogue options that only reveal a quest having been
available/given after selecting the option that assigns it to you. Pay attention
to what NPCs say — the deepstate rewards the observant and files away the rest.

### Dialogue

In-game dialogue and character rendering is handled by
[`grillsay`](tools/grillsay/README.md), a `cowsay`-style engine in which every
character is delivered with the gravitas of a man guarding his lawn. Dialogue
lines are word-wrapped into speech bubbles above the character art.

### Economy & Market

Items can be collected throughout the world and traded with other players on the
market. Prices fluctuate with supply, demand, and whatever the Ministry of
Valuation decrees this week.

### Combat & Bosses

Enemies and bosses stand between you and the truth. Combat is resolved through
the game's encounter system — bring items, bring friends, and bring a plausible
cover story.

### Espionage

Surveillance cuts both ways. Players can perform espionage: gathering
intelligence, tailing suspicious NPCs, and uncovering what the Agencies would
rather keep filed under miscellaneous.

### The Cameras System

The core loop of FlockWatch is surveillance itself. Take Flock contracts to
**put cameras up** and earn wages — or join the resistance and **take cameras
down** to strip them for scrap. Scrap isn't junk: lenses, housings, wiring, and
circuit boards are crafted into tools, equipment, and tradeable goods. The
cameras go up, the cameras come down, and everyone gets paid. Region
surveillance coverage shifts with every camera installed or dismantled — the
whole server is playing both sides of the same war.

### Multiplayer

FlockWatch is an MMORPG with persistent, cookie-backed characters and live
same-location presence. Gather with friends, form cells of like-minded citizens,
share assignments, and coordinate group boss fights or three-stage field
operations. Trust is directional: only citizens you explicitly trust can receive
your items or regional intelligence. Spend it carefully.

Regional state is delivered in real time over authenticated WebSockets. Each
city has an isolated event channel for presence, message-board posts, market and
camera changes, region ticks, and cooperative operations; clients reconnect with
bounded exponential backoff.

Production reverse proxies must preserve WebSocket upgrades. The included nginx
template forwards `Upgrade` and `Connection`, disables proxy buffering, and
keeps regional channels open between heartbeat events. After updating an
existing installation, render the new template and reload nginx with
`sudo nginx -t && sudo systemctl reload nginx`.

### A Nation Under Watch

The world of FlockWatch is organized around watched cities: Cleveland, New
Orleans, Seattle, Atlanta, New York City, and the deliberate regional exception
of Silicon Valley. Each has travelable sublocations, local statistics,
surveillance coverage, and its own economy. Scrap that's worthless in one city
may be gold in the next; a city drowning in cameras pays better wages but
watches every move you make.

Every city also has one public message board. Players can leave short local
notices, trade warnings, or manufacture entirely new reasons to be investigated.

## Running the Server

The game is served by a [Deno](https://deno.land/) application built on
[oak](https://jsr.io/@oak/oak).

```sh
deno task start
```

Then open [http://localhost:8000](http://localhost:8000).

## Documentation

- [docs/spec.md](docs/spec.md) — technical and game design specification
- [docs/design.md](docs/design.md) — design notes
- [docs/roadmap.md](docs/roadmap.md) — planned features and milestones
- [tools/grillsay/README.md](tools/grillsay/README.md) — the dialogue engine

## Contributing

FlockWatch is under active development. The deepstate is also under active
development. Only one of these can win.
