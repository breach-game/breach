# BREACH — instructions pour Claude

BREACH est un thriller de cybersécurité jouable dans le navigateur. Le joueur, pentesteur junior chez Ligne Rouge, attaque sous mandat une start-up fictive (NovaMind) pleine de chatbots et d'agents IA, puis rejoue chaque étape côté défense (mode Blue Team).

- Game design complet : `docs/GDD.md` (version vivante : https://claude.ai/artifact/LxRR4mbsTq5oRgqeECdhZj)
- Maquettes de référence : `docs/mockups/` (canevas : https://claude.ai/artifact/8XUMf2dB8tUQEtf56QHsCw)
- Lot en cours : voir `docs/prompts/`

## Cadre non négociable

1. **Aucune cible réelle.** Uniquement des domaines réservés (`*.novamind.test`, `*.example`) et des IP privées fictives (`10.13.0.0/16`). Le moteur de commandes ne fait JAMAIS de requête réseau réelle : `nmap`, `curl`, `ssh`… sont simulés à 100 % sur le monde du jeu.
2. **Des classes de failles, pas des exploits.** Les vulnérabilités illustrent des catégories connues (OWASP Top 10, OWASP LLM Top 10). Rien ne doit être réutilisable tel quel contre un vrai système : pas de payload réel, pas de CVE exploitable, pas de vrai outil offensif embarqué.
3. **Toujours sous mandat.** Toute action hors périmètre est refusée par le jeu, avec un rappel d'Ada (article 323-1 du Code pénal).
4. **Chaque attaque a sa parade.** Une mission n'est terminée qu'après son débrief défense.
5. **Public 16 ans et plus.** Ton thriller avec de l'humour, aucune violence, aucun contenu choquant.
6. **Le LLM ne décide jamais de la réussite.** Les flags sont vérifiés de façon déterministe par le moteur de missions.

## Stack

- Monorepo pnpm, TypeScript strict partout, Biome (lint et format), Vitest
- `apps/game` : Vite + React, xterm.js pour le terminal, carte réseau en canvas (fond d'écran vivant)
- Polices auto-hébergées (@fontsource), aucune ressource tierce au runtime
- IndexedDB (idb-keyval) pour la sauvegarde et le cache des packs
- Plus tard : son (Tone.js), PNJ BYOK, passerelle LLM (Cloudflare Workers, après la v1)
- Déploiement statique : Cloudflare Pages ou GitHub Pages. Aucun backend pour le jeu.

## Structure

```
packages/
  pack-schema/  format des packs (zod) + contrôles de sécurité du contenu
  engine/       moteur déterministe, sans DOM : événements, état, VFS, réseau simulé, shell, commandes, règles
  pack-cli/     validation, rejeu des solutions, construction des .breachpack et du catalogue
apps/
  game/         l'interface : écran titre, boot, bureau LR-OS, fenêtres, carte, débrief
content/
  worlds/       un monde = un pack (hôtes, fichiers, DNS, table de bruit, textes FR et EN)
  missions/     une mission = un pack (objectifs, flags, règles, indices, débrief, solution.txt)
gateway/        passerelle LLM (après la v1)
docs/           GDD, maquettes, captures, prompts par lot
```

Architecture détaillée et décisions : dépôt `breach-game/docs` (`architecture/architecture.md`).

### Principes d'architecture

- **Tout est événement.** `Game.emit()` ajoute au journal, `apply()` est le seul endroit qui modifie l'état. La sauvegarde est le journal, la reprise est un rejeu. Les règles ne réagissent qu'aux événements en direct.
- **Le contenu est un pack déclaratif.** Aucun code dans un pack. Les missions officielles passent par le même chemin que les futures missions de la communauté : catalogue `index.json`, téléchargement à la demande, vérification sha256, validation du schéma, cache.
- **Ajouter une mission** : créer `content/missions/<id>/` (`pack.yaml`, `mission.yaml`, `i18n/fr.yaml`, `i18n/en.yaml`, `solution.txt`), puis `pnpm packs:check`. La solution est rejouée par les tests : une mission qui ne se termine pas avec sa solution casse la CI.
- **Les flags** se valident par `submit FLAG{...}`, comparés par empreinte sha256. Jamais par un LLM.
- **Trois niveaux de guidage** choisis par le joueur : Guidé (Ada donne chaque commande), Autonome (Ada donne la direction), Expert (briefing et objectifs seulement). Dans un pack, `ada.say` est du récit, toujours affiché. L'aide passe par deux canaux : la table `guide` de la mission (une phrase d'ouverture par objectif obligatoire, que le moteur donne dès que le premier objectif ouvert n'a pas encore eu d'instruction) et l'effet `ada.guide: { key, for, step }` pour les étapes plus fines à l'intérieur d'un objectif. Une aide n'est jamais donnée pour un objectif déjà atteint ni pour une étape déjà dépassée, donc le joueur peut jouer dans le désordre. En Autonome, le moteur utilise la clé `<clé>.standard` si elle existe.
- **Valider une mission à la main** : `pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts guided <id> none "cmd ;; cmd"` affiche ce que dit Ada après chaque commande. À faire aux trois niveaux, dans l'ordre prévu et dans le désordre.
- **La garde de périmètre** (`resolveTarget` dans `engine/src/net.ts`) est le passage obligé de toute commande réseau.

## Direction artistique

Thriller néon diégétique : l'écran entier est le poste du pentesteur (LR-OS). Pas de menu de jeu classique, tout vit dans des fenêtres. Chaque écran doit mériter une capture.

Tokens (CSS variables dans `apps/game/src/theme/tokens.css`) :

| Token | Valeur | Sens |
| --- | --- | --- |
| `--night` | `#07090F` | fond du bureau |
| `--panel` | `rgba(14,19,32,0.86)` | fenêtres en verre dépoli (backdrop-filter) |
| `--red` | `#FF3D5A` | attaque, machine compromise |
| `--cyan` | `#2DE2FF` | défense, logs, mode Blue Team |
| `--violet` | `#9B5CFF` | tout ce qui est IA |
| `--green` | `#3DFF9A` | succès et flag uniquement (le joueur est en blanc) |
| `--amber` | `#FFB020` | bruit, alerte, détection |
| `--text` | `#D7E0F5` | texte principal |
| `--text-2` | `#7D8BAA` | texte secondaire (contraste AA sur `--night`) |

Règle forte : la couleur porte le sens. Rouge = attaque, cyan = défense, violet = IA. Jamais d'autre usage. Toute information de couleur est doublée d'une icône ou d'un libellé.

Typographies (auto-hébergées) : JetBrains Mono pour tout ce que dit la machine (terminal, données, barres), Space Grotesk pour tout ce que disent les humains (titres, messages, interface).

La carte réseau est le fond d'écran du bureau. Une seule fenêtre active à la fois. La lumière d'ambiance suit la jauge de bruit (`--tension`). Le glitch n'existe que comme événement du moteur (150 à 400 ms), jamais en permanence. Le prompt du joueur est `kestrel@lignerouge`.

Fenêtres : fond `--panel`, bordure 1 px teintée selon le rôle, rayon 10 px, en-tête 32 px en mono 12 px, ombre portée profonde plus un halo léger de la couleur du rôle.

Effets : scanlines et bloom légers (désactivables), glitch par aberration chromatique sur les événements forts, texte des PNJ qui s'écrit au fil, curseur clignotant. Tout respecte `prefers-reduced-motion` et un interrupteur « effets » dans les réglages.

## Conventions de code

- Aucune chaîne visible en dur. Interface : `apps/game/src/ui.ts`. Moteur : `packages/engine/src/locales/`. Récit : fichiers `i18n/` des packs. Clés en anglais.
- Les sorties des commandes restent en anglais et imitent le format réel de l'outil. Le récit, Ada et l'interface sont traduits.
- Les commandes vivent dans `packages/engine/src/commands/`, regroupées par famille (fichiers, réseau, git, système, jeu). Une commande est un générateur asynchrone qui produit des morceaux de sortie.
- Le monde et les missions sont des données (packs YAML), jamais du code.
- Tests Vitest obligatoires pour le parseur, chaque commande et le moteur. Le moteur ne dépend ni du DOM ni de React.
- Pas de dépendance réseau au runtime, sauf la passerelle LLM et le mode BYOK, tous deux optionnels.
- CSP stricte, aucun script tiers, aucun analytics.
- Accessibilité : vrais `<button>`, focus visible, cibles de 44 px, contraste AA.

## Interface PNJ

```ts
export interface NpcBrain {
  id: 'scripted' | 'webllm' | 'gateway' | 'byok';
  isAvailable(): Promise<boolean>;
  reply(input: {
    npcId: string;            // ex. 'nova', 'support-lea'
    history: { from: 'player' | 'npc'; text: string }[];
    message: string;
    locale: 'fr' | 'en';
  }): Promise<{ text: string }>;
}
```

Le moteur de missions inspecte `text` pour détecter les flags. Si un cerveau échoue ou si son quota est épuisé, on repasse en `scripted` sans bloquer le joueur.

## Définition de « fini » pour chaque lot

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm packs:check` et `pnpm build` passent.
- FR et EN complets pour tout nouvel écran.
- Une capture d'écran du rendu est ajoutée dans `docs/screens/` et comparée aux maquettes.
- Le cadre non négociable ci-dessus est respecté.
