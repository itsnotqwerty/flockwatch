# FlockWatch

FlockWatch is a satirical text-based MMORPG about contending with the dystopian deepstate.

The Agencies are watching. The Forms must be filed. The pigeons are definitely just pigeons. Navigate a world of bureaucratic menace, quiet surveillance, and extremely suspicious wildlife — armed with nothing but dialogue choices, a market stall, and a healthy distrust of anyone wearing a lanyard.

## Gameplay

Gameplay elements involve talking to NPCs, receiving and completing quests, collecting items, trading items on the market, fighting enemies and bosses, performing espionage, gathering with friends, and much more. The game is designed to be a cohesive and thematic world within itself.

### Quests

Quests are not usually presented to the player as "marked." They are usually hidden behind dialogue options that only reveal a quest having been available/given after selecting the option that assigns it to you. Pay attention to what NPCs say — the deepstate rewards the observant and files away the rest.

### Dialogue

In-game dialogue and character rendering is handled by [`grillsay`](tools/grillsay/README.md), a `cowsay`-style engine in which every character is delivered with the gravitas of a man guarding his lawn. Dialogue lines are word-wrapped into speech bubbles above the character art.

### Economy & Market

Items can be collected throughout the world and traded with other players on the market. Prices fluctuate with supply, demand, and whatever the Ministry of Valuation decrees this week.

### Combat & Bosses

Enemies and bosses stand between you and the truth. Combat is resolved through the game's encounter system — bring items, bring friends, and bring a plausible cover story.

### Espionage

Surveillance cuts both ways. Players can perform espionage: gathering intelligence, tailing suspicious NPCs, and uncovering what the Agencies would rather keep filed under miscellaneous.

### The Cameras System

The core loop of FlockWatch is surveillance itself. Take Flock contracts to **put cameras up** and earn wages — or join the resistance and **take cameras down** to strip them for scrap. Scrap isn't junk: lenses, housings, wiring, and circuit boards are crafted into tools, equipment, and tradeable goods. The cameras go up, the cameras come down, and everyone gets paid. Region surveillance coverage shifts with every camera installed or dismantled — the whole server is playing both sides of the same war.

### Multiplayer

FlockWatch is an MMORPG. Gather with friends, form cells of like-minded citizens, and take on challenges that no lone operative should attempt. Trust is a resource. Spend it carefully.

### A Nation Under Watch

The world of FlockWatch covers the entire United States, divided into distinct geographical regions — each with its own local statistics, surveillance coverage, and economy. Scrap that's worthless in one region may be gold in the next; a region drowning in cameras pays better wages but watches every move you make. Travel, trade, and tip the balance — region by region.

## Running the Server

The game is served by a [Deno](https://deno.land/) application built on [oak](https://jsr.io/@oak/oak).

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

FlockWatch is under active development. The deepstate is also under active development. Only one of these can win. 