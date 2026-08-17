<div align="center">

# Chronicles of Chaos

### 乱世风云录

An LLM-driven interactive narrative RPG where characters and the Three Kingdoms world persist and evolve through validated local state.

[简体中文](README.md) · **v1.7.24** · [Play online](https://cocsg.pages.dev/)

</div>

![The home screen of Chronicles of Chaos](docs/media/home.png)

## Enter a life that does not reset each turn

Create an unknown traveller or play a historical figure, then enter the late Han and Three Kingdoms era from a chosen date, region, identity, and personal situation. History provides the structure of the world, but it does not dictate the player's story. The same age of upheaval may become the journey of a wanderer, a local official's dilemma, a warlord court intrigue, or the long rise and fall of a household, army, and territory.

The project does not lock play into a fixed quest tree. The LLM interprets actions, writes the narrative, and proposes developments. The local runtime preserves facts, validates structured writeback, manages character memory, and ensures that later turns inherit the choices and consequences that actually occurred.

## Core experience

- **Custom and historical starts** — World pack, date bookmark, origin, identity, location, and player requirements shape the opening. Historical profiles may be completed against the current world line.
- **A persistent world, not a one-turn chat** — Characters, places, items, money, quests, relationships, factions, holdings, troops, and historical conditions enter the save through validated structured writeback. Narrative prose cannot silently replace canonical state.
- **NPCs that remember and act off-screen** — Characters keep profiles, recent experiences, compressed mid- and long-term memory, and relationship state. Important NPCs may continue acting when the player is elsewhere.
- **Faction, holding, and troop evolution** — Political actions, civil administration, resources, military supply, troop locations, and remote intelligence change with game time and inherit the player's established world line.
- **Rule-backed combat and war** — The local engine resolves checks and deterministic outcomes before the main model narrates them. Injuries, casualties, victories, territory, and consequences remain in long-term state.
- **A Three Kingdoms world pack with 1,500 StoryPack entries** — Cross-role, cross-period, and cross-region narrative material is selected against historical knowledge and current facts without forcing history to repeat mechanically.
- **Local-first long-save architecture** — IndexedDB stores manual and automatic saves, turn history, and larger state payloads. ZIP import/export, story export, rerolls, and turn rollback are supported.
- **Independent model routes** — Main narrative, state writeback, memory summarisation, embeddings, NPC simulation, profile completion, world evolution, and image-prompt generation may use separate API profiles and models.
- **Cross-device cloud saves** — Sign in with Discord to upload or download saves between desktop and mobile. Synchronising API settings is always an explicit player choice.
- **Correspondence and off-screen lives** — Write and receive letters, keep conversation histories, and follow important characters as their circumstances and historical trajectories continue with game time.
- **Desktop, mobile, and dual themes** — Situation, map, character, bond, romance, inventory, art, faction, holding, troop, conflict, combat, and memory panels reflow for the device, with dark and light themes.

## Highlights in v1.7.24

- Expanded personal combat, warfare, unit match-ups, command impact, and projected unique-art effects, with outcomes resolved by local rules and persisted into the save.
- Expanded holdings, private estates, troops, correspondence, relationship-character evolution, character memory, cloud saves, and variable management.
- Added separate narrative, personal-combat, and warfare difficulty controls, alongside opening, map, archive, inventory, and mobile-interface improvements.
- Added presets for GLM Coding Plan and MiniMax domestic/international endpoints while preserving OpenAI, DeepSeek, Gemini, Claude, Qwen, and generic compatible routes.

## Game interface

![The main game interface](docs/media/game-main.png)

| World map | Evolving situation |
| --- | --- |
| ![The world map with locations and routes](docs/media/world-map.png) | ![Current matters, ongoing developments, and history](docs/media/world-dynamics.png) |

The map, situation view, and archive panels are projections of the same persistent fact state, not a second simulation detached from the narrative.

## Run locally

Install a current Node.js LTS release and npm, then run:

```powershell
npm ci
npm run dev
```

Vite will print the local URL. On first launch:

1. save a main narrative API profile and assign its model;
2. optionally configure state writeback, memory summarisation, embeddings, NPC simulation, profile completion, and world evolution;
3. choose the Three Kingdoms world pack, date, opening mode, and character;
4. begin a new save or import an existing local ZIP archive.

The settings UI includes OpenAI, DeepSeek, Gemini, Anthropic Claude, Qwen, GLM (including Coding Plan), MiniMax, Moonshot/Kimi, Doubao, xAI, Groq, Mistral, Ollama, LM Studio, OpenAI-compatible, and custom endpoint options. Model availability, billing, content policy, and data handling are governed by the third-party service selected by the player.

### Build and verify

```powershell
npm run lint
npm test
npm run build
```

The default test suite does not call paid real-world APIs.

## Local data, APIs, and privacy

- API profiles, keys, saves, generated story, and runtime state stay in the player's browser or device by default.
- Model requests go directly from the browser to the third-party service chosen by the player. The developer does not operate an AI proxy for those requests.
- If the player explicitly enables cloud saves, compressed save archives are stored in the project's Cloudflare R2 bucket and identity/index records are stored in D1. Generated images are not uploaded automatically, and API settings are synchronised only when the player explicitly opts in.
- Exported API settings may contain plaintext keys. Treat them as private migration or backup files; never commit them to Git or share them publicly.
- Optional Cloudflare Pages Functions + D1 analytics collect only limited anonymous operational metrics such as online presence, sessions, language, device class, version, and coarse IP-derived region.
- Analytics do not store raw IP addresses and do not collect player input, story text, saves, relationships, API configuration, keys, prompts, model names, or model request/response bodies.
- Local development does not send analytics by default. Anonymous heartbeat events are enabled only for production builds or explicit testing.

## Content notice

The project uses publicly available historical, geographical, institutional, and biographical material to establish its setting. Apart from preloaded reference material, dynamic events, dialogue, relationships, and story developments are generated at runtime from the player's choices, current save state, and selected third-party AI service.

Generated content is fictional material belonging only to the relevant local world line. It does not represent the real experiences, words, views, or character of any real or historical person. The game is not authorised, sponsored, endorsed, or produced in cooperation with any person, institution, company, or other rights holder mentioned in it.

Corrections and rights notices: **kale014@gmail.com**

## Licences

© 2026 RedCliffScribe.

- **Software code** — Open source under [`AGPL-3.0-only`](LICENSE). It may be used, modified, and operated commercially, but distribution or network operation of a modified version must provide the corresponding source as required by the licence.
- **Original content assets** — Original artwork, demonstration images, StoryPack/WorldPack narrative content, and other non-code works that RedCliffScribe is authorised to license are available under [`CC BY-NC-SA 4.0`](LICENSE-ASSETS.md). Attribution is required, commercial use is prohibited, and shared adaptations must use the same licence.

The software code is open source, but the complete game containing the covered content assets may not be used commercially without separate permission. These licences apply only to material owned by or licensable by RedCliffScribe; they do not grant rights in third-party names, trademarks, public facts, or other third-party material. Commercial licensing enquiries: **kale014@gmail.com**.
