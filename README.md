<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/breach-wordmark-dark-bg.svg">
    <img alt="BREACH" src="docs/brand/breach-wordmark-light-bg.svg" width="380">
  </picture>
</p>

# BREACH

**FR** — Un thriller de cybersécurité dans ton navigateur. Tu es pentesteur junior chez Ligne Rouge, sous mandat pour tester NovaMind, une start-up truffée de chatbots et d'agents IA. Attaque, comprends, puis rejoue chaque étape côté défense.

**EN** — A cybersecurity thriller in your browser. You are a junior pentester at Ligne Rouge, contracted to test NovaMind, a startup full of chatbots and AI agents. Attack, understand, then replay every step as the defender.

> Toutes les cibles sont fictives. Le jeu n'effectue aucune requête réseau réelle.
> All targets are fictional. The game never makes real network requests.

## État / Status

Les quatre missions de la v1 sont jouables de bout en bout, en français et en anglais : 0 « Le mandat », 1 « Empreinte » (reconnaissance), 2 « Le stagiaire bavard » (ingénierie sociale) et 3 « Nova en sait trop » (injection de prompt).

The four v1 missions are playable end to end, in French and English: 0 "The Mandate", 1 "Footprint" (reconnaissance), 2 "The Talkative Intern" (social engineering) and 3 "Nova Knows Too Much" (prompt injection).

![Bureau LR-OS](docs/screens/lot0-03-carte-nmap.png)

## Développement / Development

Node 22+, pnpm 10.

```bash
pnpm install
pnpm dev          # construit les packs puis lance le jeu / builds packs, starts the game
pnpm test         # moteur, commandes, packs et solutions / engine, commands, packs, solutions
pnpm packs:check  # valide le contenu / validates the content
pnpm build        # site statique dans apps/game/dist / static site
```

| Dossier / Folder | Rôle / Role |
| --- | --- |
| `packages/engine` | moteur déterministe, sans DOM / deterministic engine, no DOM |
| `packages/pack-schema` | format des packs et contrôles de sécurité / pack format and safety checks |
| `packages/pack-cli` | validation et construction des packs / pack validation and build |
| `apps/game` | interface LR-OS / LR-OS interface |
| `content/` | monde NovaMind et missions / NovaMind world and missions |

Une mission est un pack déclaratif, sans code. Pour en ajouter une, voir `CLAUDE.md`.
A mission is a declarative pack with no code. To add one, see `CLAUDE.md`.

## Licence / License

MIT, voir [LICENSE](LICENSE).
