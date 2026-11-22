<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/breach-wordmark-dark-bg.svg">
    <img alt="BREACH" src="docs/brand/breach-wordmark-light-bg.svg" width="380">
  </picture>
</p>

# BREACH

A cybersecurity thriller in your browser. You are a junior pentester at Ligne Rouge, contracted to test NovaMind, a startup full of chatbots and AI agents. Attack, understand, then replay every step as the defender.

The game is available in English and French.

> All targets are fictional. The game never makes real network requests.

## Status

The four v1 missions are playable end to end, in English and French: 0 "The Mandate", 1 "Footprint" (reconnaissance), 2 "The Talkative Intern" (social engineering) and 3 "Nova Knows Too Much" (prompt injection).

![LR-OS desktop](docs/screens/lot0-03-carte-nmap.png)

## Character voices (optional)

The whole game plays without any key: the characters follow a script. In the settings you can give your own Anthropic API key so that a model says their lines in its own words. The script always decides what a character gives away, and flags are checked by the engine. The key stays in your browser and calls go straight to `api.anthropic.com`. It is the game's only outside connection, and it does not exist until a key is set.

## Development

Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # builds the packs, then starts the game
pnpm test         # engine, commands, packs and mission solutions
pnpm packs:check  # validates the content
pnpm build        # static site in apps/game/dist
```

| Folder | Role |
| --- | --- |
| `packages/engine` | deterministic engine, no DOM |
| `packages/pack-schema` | pack format and content safety checks |
| `packages/pack-cli` | pack validation and build |
| `apps/game` | LR-OS interface |
| `content/` | NovaMind world and missions |
| `gateway/` | optional LLM gateway for free-form NPC dialogue (after v1) |

A mission is a declarative pack with no code. To add one, see `CLAUDE.md`.

Design documents (game design, architecture, reviews, mockups) live in [breach-game/docs](https://github.com/breach-game/docs).

## License

MIT, see [LICENSE](LICENSE).
