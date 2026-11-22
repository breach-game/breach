<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/breach-wordmark-dark-bg.svg">
    <img alt="BREACH" src="docs/brand/breach-wordmark-light-bg.svg" width="380">
  </picture>
</p>

# BREACH

A cybersecurity thriller in your browser. You are a junior pentester at Ligne Rouge, contracted to test NovaMind, a startup full of chatbots and AI agents. Attack, understand, then replay every step as the defender.

The game is available in English and French.

**Play it online: https://breach-game.github.io/breach/** (nothing to install, no account; your progress stays in your browser).

> **Nothing here is real.** The commands are simulated, the targets are fictional, and the game never sends a single packet to anyone. See [Everything is simulated](#everything-is-simulated).

## Status

The four v1 missions are playable end to end, in English and French: 0 "The Mandate", 1 "Footprint" (reconnaissance), 2 "The Talkative Intern" (social engineering) and 3 "Nova Knows Too Much" (prompt injection).

![LR-OS desktop](docs/screens/lot0-03-carte-nmap.png)

## Everything is simulated

The terminal looks and answers like the real tools, but it is a game engine written in TypeScript that runs entirely in your browser tab. There is no server behind it and no real shell.

- **The commands are imitations.** `nmap`, `curl`, `ssh`, `ping`, `dig`, `whois`, `git` and the others have no network code at all. Each one reads the fictional NovaMind world, loaded in memory from a data pack, and prints what the real tool would print. A "port scan" is a lookup in a table; its delay is a timer.
- **The targets do not exist.** Every host lives under `*.novamind.test` (a top-level domain reserved for testing, RFC 2606) or in the private range `10.13.0.0/16`. A pack that names a real-looking domain or a public address (apart from a few learning sites such as owasp.org, given as reading links) is refused when it is built and again when the game loads it.
- **The scope check is a game rule, not a safety net.** Aiming at an address outside the mandate (say `nmap 8.8.8.8`) gets a reminder from Ada about the law. Even if that check had a hole, the command would still only reach the simulated world: there is nothing that could send a real request.
- **The in-game browser draws pages itself.** It renders the world's pages from data. It loads no URL, follows no real link and has no iframe.
- **The vulnerabilities are classes, not exploits.** They illustrate OWASP Top 10 and OWASP LLM Top 10 categories. Nothing in the game works against a real system.

The only real requests the page ever makes:

| Request | Destination | When |
| --- | --- | --- |
| The game itself (HTML, scripts, fonts) | the site's own origin | on load |
| The mission packs (`packs/index.json`, `*.breachpack`) | the site's own origin | on load, then cached |
| Community missions (`index.json`, its signature, `*.breachpack`) | `breach-game.github.io/packs/` | only when you open *Community missions* |
| Model help for the characters | `api.anthropic.com` | only if you set your own API key and switch on a use |

The production Content Security Policy only allows those destinations, so the browser would block anything else.

## Model help for the characters (optional)

The whole game plays without any key: the characters follow a script. In the settings you can give your own Anthropic API key and choose what it is used for, each use with its own model and an estimate of what it costs:

- **Understand my messages**: a model recognises what you ask even when worded freely, in another language or with typos. It can only point at words the character already listens for, never a name or code word you have to find yourself.
- **Reword the replies**: a model says the line the script chose in its own words.

The script always decides what a character gives away, and flags are checked by the engine, so a mission plays out the same with or without a key. The key stays in your browser and calls go straight to `api.anthropic.com`. It is the game's only outside connection, and it does not exist until a key is set. Details in [SECURITY.md](SECURITY.md).

## Development

Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # builds the packs, then starts the game
pnpm test         # engine, commands, packs and mission solutions
pnpm packs:check  # validates the content
pnpm build        # static site in apps/game/dist
```

Going live: [docs/deploy.md](docs/deploy.md). Nothing is published automatically. Security model and how to report a problem: [SECURITY.md](SECURITY.md).

| Folder | Role |
| --- | --- |
| `packages/engine` | deterministic engine, no DOM |
| `packages/pack-schema` | pack format and content safety checks |
| `packages/pack-cli` | pack validation and build |
| `apps/game` | LR-OS interface |
| `content/` | NovaMind world and missions |
| `gateway/` | optional LLM gateway for free-form NPC dialogue (after v1) |

A mission is a declarative pack with no code. Official missions live in `content/` (see `CLAUDE.md`). Missions written by players live in [breach-game/packs](https://github.com/breach-game/packs), which has the guide for writing one; the game lists them under *Community missions*.

Design documents (game design, architecture, reviews, mockups) live in [breach-game/docs](https://github.com/breach-game/docs).

## License

MIT, see [LICENSE](LICENSE).
