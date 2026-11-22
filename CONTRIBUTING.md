# Contributing to BREACH

Thanks for wanting to help. BREACH is a cybersecurity thriller that teaches how attacks work, and how to stop them, without ever touching a real system. Every contribution has to keep it that way.

There are three ways to contribute, each in its own place:

| You want to… | Go to |
| --- | --- |
| Write a new mission or a new world | [breach-game/packs](https://github.com/breach-game/packs) and its [guide](https://github.com/breach-game/packs/blob/main/CONTRIBUTING.md). No code needed. |
| Report a bug, suggest an idea, fix the game or the engine | this repository (issues and pull requests) |
| Discuss the game design or the architecture | [breach-game/docs](https://github.com/breach-game/docs) |

A security problem never goes in a public issue: see [SECURITY.md](SECURITY.md).

By taking part you agree to follow the [Code of Conduct](https://github.com/breach-game/.github/blob/main/CODE_OF_CONDUCT.md).

## The rules that never bend

Pull requests that break one of these are closed, however good the rest is.

1. **No real target.** Only reserved domains (`*.novamind.test`, `*.example`) and fictional private addresses (`10.13.0.0/16`). The command engine never makes a real network request: `nmap`, `curl`, `ssh` and the others are simulated entirely on the game world.
2. **Classes of weaknesses, not exploits.** Vulnerabilities illustrate known categories (OWASP Top 10, OWASP Top 10 for LLM applications). No real payload, no exploitable CVE, no real offensive tool.
3. **Always under a mandate.** Any action outside the scope is refused by the game, with a reminder of the law.
4. **Every attack has its defence.** A mission is only finished after its defence debrief.
5. **Players aged 16 and over.** Thriller tone with humour, no violence, nothing shocking.
6. **A language model never decides success.** Flags are checked deterministically by the engine.

## Getting started

You need Node 24 or later (26 LTS recommended) and pnpm 12.

```bash
git clone https://github.com/breach-game/breach.git
cd breach
pnpm install
pnpm dev          # builds the packs, then starts the game on http://localhost:5173/
```

| Folder | Role |
| --- | --- |
| `packages/engine` | deterministic engine, no DOM: events, state, file system, simulated network, shell, commands, rules |
| `packages/pack-schema` | pack format (zod) and content safety checks |
| `packages/pack-cli` | pack validation, solution replay, `.breachpack` and catalogue builds |
| `apps/game` | the LR-OS interface (Vite, React, xterm.js) |
| `content/` | the official NovaMind world and the campaign missions |

[`CLAUDE.md`](CLAUDE.md) (in French) describes the architecture principles in detail, and [breach-game/docs](https://github.com/breach-game/docs) holds the design documents in English and French.

## Before you open a pull request

All five must pass, exactly as CI runs them:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm packs:check
pnpm build
```

And depending on what you changed:

- **Engine or commands.** Every command and every engine change comes with Vitest tests. The engine never depends on the DOM or React.
- **Command output.** Stays in English and imitates the real tool's format.
- **Visible text.** Never hard-coded. Interface strings go in `apps/game/src/ui.ts`, engine strings in `packages/engine/src/locales/`, story text in the pack's `i18n/` files. Every new string exists in both English and French.
- **Screens.** Add a screenshot of the result in `docs/screens/` and describe it in the pull request.
- **Missions in `content/`.** A mission folder holds `pack.yaml`, `mission.yaml`, `i18n/fr.yaml`, `i18n/en.yaml` and `solution.txt`. The solution is replayed by the tests: a mission that cannot be finished with it breaks CI. Check what Ada says at each guidance level with `pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts guided <id> none "cmd ;; cmd"`.
- **Accessibility.** Real `<button>` elements, visible focus, 44 px targets, AA contrast, and `prefers-reduced-motion` respected.
- **Security.** No `innerHTML`, no third-party script, no new network destination. Read [SECURITY.md](SECURITY.md) first if you touch the terminal, packs, the catalogue or the optional API key.

## Pull requests

- Keep one pull request to one topic, and explain what the player will see.
- Write the title, description, commit messages and code comments in English.
- Fill in the pull request template.
- A maintainer reviews every change. Nothing is deployed automatically: the site is published by hand after a merge.

## Licence

BREACH is released under the [MIT licence](LICENSE). By opening a pull request you agree that your contribution is published under it.
