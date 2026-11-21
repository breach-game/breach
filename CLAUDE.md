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

- Vite + React + TypeScript (strict), pnpm
- xterm.js pour le terminal, react-three-fiber pour la carte réseau 3D (repli 2D automatique)
- GSAP pour les animations d'interface, Tone.js pour le son
- i18next (FR et EN dès le départ)
- WebLLM pour le mode local, IndexedDB (idb) pour la sauvegarde
- Vitest pour les tests, Playwright plus tard pour les captures
- Déploiement statique : Cloudflare Pages ou GitHub Pages. Aucun backend pour le jeu.

## Structure

```
src/
  os/          bureau LR-OS : gestionnaire de fenêtres, barre de statut, dock
  terminal/    interpréteur, parseur, commandes (une commande = un fichier), autocomplétion
  world/       monde simulé : hôtes, système de fichiers virtuel, comptes, logs
  missions/    moteur de missions : objectifs, flags, bruit, indices, checkpoints
  npc/         interface NpcBrain + implémentations (scripted, webllm, gateway, byok)
  map/         carte réseau 3D et repli 2D
  audio/       musique générative et sons d'interface
  i18n/        fr.json, en.json
  theme/       tokens de design (CSS variables) et typographies
content/
  missions/    une mission = un fichier YAML (voir m01-empreinte.yaml)
gateway/       passerelle LLM (projet séparé, déployé sur le VPS)
docs/          GDD, maquettes, prompts par lot
```

## Direction artistique

Thriller néon diégétique : l'écran entier est le poste du pentesteur (LR-OS). Pas de menu de jeu classique, tout vit dans des fenêtres. Chaque écran doit mériter une capture.

Tokens (à exposer en CSS variables dans `src/theme/tokens.css`) :

| Token | Valeur | Sens |
| --- | --- | --- |
| `--night` | `#07090F` | fond du bureau |
| `--panel` | `rgba(14,19,32,0.86)` | fenêtres en verre dépoli (backdrop-filter) |
| `--red` | `#FF3D5A` | attaque, machine compromise |
| `--cyan` | `#2DE2FF` | défense, logs, mode Blue Team |
| `--violet` | `#9B5CFF` | tout ce qui est IA |
| `--green` | `#3DFF9A` | succès, flag, poste du joueur |
| `--amber` | `#FFB020` | bruit, alerte, détection |
| `--text` | `#D7E0F5` | texte principal |
| `--text-2` | `#7D8BAA` | texte secondaire (contraste AA sur `--night`) |

Règle forte : la couleur porte le sens. Rouge = attaque, cyan = défense, violet = IA. Jamais d'autre usage. Toute information de couleur est doublée d'une icône ou d'un libellé.

Typographies (Google Fonts) : JetBrains Mono (terminal, données, barres), Space Grotesk (titres, génériques), Inter (interface, messages).

Fenêtres : fond `--panel`, bordure 1 px teintée selon le rôle, rayon 10 px, en-tête 32 px en mono 12 px, ombre portée profonde plus un halo léger de la couleur du rôle.

Effets : scanlines et bloom légers (désactivables), glitch par aberration chromatique sur les événements forts, texte des PNJ qui s'écrit au fil, curseur clignotant. Tout respecte `prefers-reduced-motion` et un interrupteur « effets » dans les réglages.

## Conventions de code

- Aucune chaîne visible en dur : tout passe par i18next, clés en anglais (`terminal.errors.outOfScope`).
- Une commande du terminal = un module `src/terminal/commands/<nom>.ts` qui exporte `{ name, help, run(args, ctx) }`. Les sorties imitent le format réel de l'outil.
- Le monde et les missions sont des données (YAML chargé au build), jamais du code.
- Tests Vitest obligatoires pour le parseur, chaque commande et le moteur de missions.
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

- `pnpm build` et `pnpm test` passent.
- FR et EN complets pour tout nouvel écran.
- Une capture d'écran du rendu est ajoutée dans `docs/screens/` et comparée aux maquettes.
- Le cadre non négociable ci-dessus est respecté.
