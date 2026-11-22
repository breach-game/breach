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
- PNJ BYOK optionnel (`@anthropic-ai/sdk`, chargé à la demande)
- Son généré en direct avec l'API Web Audio (`apps/game/src/audio.ts`), sans fichier audio ni bibliothèque
- Plus tard : passerelle LLM (Cloudflare Workers, après la v1)
- Déploiement statique : Cloudflare Pages ou GitHub Pages (`docs/deploy.md`). GitHub Pages publie automatiquement à chaque fusion sur `main`. Aucun backend pour le jeu.

## Structure

```
packages/
  pack-schema/  format des packs (zod) + contrôles de sécurité du contenu
  engine/       moteur déterministe, sans DOM : événements, état, VFS, réseau simulé, shell, commandes, règles
  pack-cli/     validation, rejeu des solutions, construction des .breachpack et du catalogue
apps/
  game/         l'interface : écran titre, boot, bureau LR-OS, fenêtres (terminal, navigateur, messagerie, carnet), carte, débrief
content/
  worlds/       un monde = un pack (hôtes, fichiers, DNS, table de bruit, textes FR et EN)
  missions/     une mission = un pack (objectifs, flags, règles, indices, débrief, solution.txt)
  trainings/    entraînements : missions courtes hors campagne, une technique chacune
gateway/        passerelle LLM (après la v1)
docs/           GDD, maquettes, captures, prompts par lot
```

Architecture détaillée et décisions : dépôt `breach-game/docs` (`architecture/architecture.md`).

### Principes d'architecture

- **Tout est événement.** `Game.emit()` ajoute au journal, `apply()` est le seul endroit qui modifie l'état. La sauvegarde est le journal, la reprise est un rejeu. Les règles ne réagissent qu'aux événements en direct.
- **Le contenu est un pack déclaratif.** Aucun code dans un pack. Les missions officielles passent par le même chemin que les futures missions de la communauté : catalogue `index.json`, téléchargement à la demande, vérification sha256, validation du schéma, cache.
- **Ajouter une mission** : créer `content/missions/<id>/` (`pack.yaml`, `mission.yaml`, `i18n/fr.yaml`, `i18n/en.yaml`, `solution.txt`), puis `pnpm packs:check`. La solution est rejouée par les tests : une mission qui ne se termine pas avec sa solution casse la CI.
- **Missions de la communauté** : dépôt `breach-game/packs` (guide `CONTRIBUTING.md`, en anglais). Sa CI valide avec `breach-pack check <dossier> --community --with content`, rejoue les solutions, puis publie sur GitHub Pages un `index.json` signé (ECDSA P-256, secret `BREACH_SIGNING_KEY` du dépôt `packs`). Le jeu vérifie la signature avec la clé publique de `apps/game/src/community.ts`, refuse tout id `breach.` venant de ce catalogue, et sauvegarde chaque mission communautaire à part (`save:community:<id>@<version>`). Les packs d'exemple sont copiés dans `packages/pack-cli/test/fixtures/community`.
- **Les sauvegardes survivent aux mises à jour.** Une sauvegarde note la version du monde et de chaque mission (`SaveData.missions`). `planResume` (`engine/src/progress.ts`) la rejoue si ni le monde ni la mission en cours n'ont changé ; sinon l'événement `ProgressCarried` garde les missions terminées et leurs scores, la mission en cours reprend à son début et Ada le dit. Le même événement sert à importer un fichier de progression (`parseProgressFile`, entrée non fiable, refusée en bloc au moindre écart). Monter la version d'un pack quand un changement casse ses anciennes sauvegardes.
- **Rejouer une mission** : l'écran « Rejouer une mission » (`screens/Missions.tsx`) liste `catalog.campaign`. Une mission terminée se rejoue seule, à n'importe quel niveau, dans sa propre sauvegarde (`save:replay:<id>@<version>`) : la partie de campagne et son score ne changent pas. La mission suivante renvoie à « Continuer », les autres restent verrouillées. `campaignProgress()` (`session.ts`) lit la progression dans le journal de la campagne.
- **Les flags** se valident par `submit FLAG{...}`, comparés par empreinte sha256. Jamais par un LLM.
- **Trois niveaux de guidage** choisis par le joueur : Guidé (Ada donne chaque commande), Autonome (Ada donne la direction), Expert (briefing et objectifs seulement). Dans un pack, `ada.say` est du récit, toujours affiché. L'aide passe par deux canaux : la table `guide` de la mission (une phrase d'ouverture par objectif obligatoire, que le moteur donne dès que le premier objectif ouvert n'a pas encore eu d'instruction) et l'effet `ada.guide: { key, for, step }` pour les étapes plus fines à l'intérieur d'un objectif. Une aide n'est jamais donnée pour un objectif déjà atteint ni pour une étape déjà dépassée, donc le joueur peut jouer dans le désordre. En Autonome, le moteur utilise la clé `<clé>.standard` si elle existe.
- **Le score** d'une mission : points des flags, plus 50 par objectif, multipliés par le niveau (Guidé ×1, Autonome ×1,25, Expert ×1,5), moins 10 par indice et 25 par détection. Le niveau compté est le plus aidé utilisé pendant la mission (`GuidanceChanged`, `state.level`) : demander plus d'aide le baisse pour de bon. `game.scoreDetail()` donne le détail affiché au débrief.
- **Types d'épreuve.** Une mission ne se gagne pas qu'avec des flags. `checks` : des conditions sur l'état du jeu, le plus souvent `{ file, contains, lacks }` sur un fichier du poste (`~` = dossier personnel), jugées par la commande `verify` ; un objectif se termine quand tous ses contrôles passent, ainsi que ceux qui ne nomment aucun objectif (les garde-fous : le fichier doit toujours faire son travail). Le joueur répare avec `sed -i`, une redirection, ou l'éditeur du poste (`edit <fichier>`, fenêtre `os/Editor.tsx`, qui enregistre par `game.writeFile` donc par l'événement `FileWritten`). `questions` : choix multiples qu'Ada pose avec l'effet `ada.ask`, affichés en boutons dans la messagerie et accessibles par `answer` ; la bonne option termine l'objectif, une mauvaise coûte 10 points et affiche son `why`. `submit` accepte aussi une réponse simple (une adresse, un identifiant) si le pack en fait un flag.
- **Séries** : un pack `kind: series` (`pack.yaml` + `series.yaml` avec la liste `missions`, de 2 à 12) enchaîne des missions d'un même monde, dans l'ordre listé et dans une seule sauvegarde (`save:community:<id de la série>@<version>`), donc ce que le joueur a fait dans une mission existe encore dans la suivante. `breach-pack check` vérifie que les missions existent, partagent le monde, ont des `order` croissants, et rejoue leurs solutions à la suite dans une seule partie. L'écran communautaire liste les séries en premier (`seriesMissions`, `seriesProgress`), cache leurs missions de la liste à plat, et propose commencer, continuer ou recommencer. Le dernier débrief donne le score de la série.
- **Fiche « ce qui s'est vraiment passé »** : `debrief.facts` (`title`, `points`, `sources: [{ label, url }]`) raconte l'incident réel dont une mission s'inspire, après la fiction. Les missions gardent des noms fictifs ; seule cette fiche nomme l'entreprise. Les adresses des sources sont le seul endroit où un pack peut écrire un vrai domaine : `https` simple imposé par le schéma, affichées en texte, jamais en lien. Ne jamais nommer une personne privée.
- **Entraînements** : missions officielles courtes hors campagne (`track: training` dans `pack.yaml`, dossiers `content/trainings/`), avec `difficulty` (1 à 3) et `skills`. Le catalogue les liste dans `training`, l'écran `screens/Training.tsx` les affiche toujours ouverts, et chacun se joue comme une mission rejouée (`save:replay:<id>@<version>`).
- **Valider une mission à la main** : `pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts guided <id> none "cmd ;; cmd"` affiche ce que dit Ada après chaque commande. À faire aux trois niveaux, dans l'ordre prévu et dans le désordre.
- **Les pages web sont des blocs déclaratifs** (`page: { title, blocks }` sur une route : `h1`, `h2`, `p`, `list`, `code`, `nav`, `link`, `comment`, `chat`, `footer`). Le navigateur du poste les dessine lui-même, et `curl` comme « Voir la source » affichent le HTML que le moteur en déduit (`pageHtml`). Un pack ne fournit jamais de balisage. Un bloc `comment` n'existe que dans la source.
- **Les personnages sont scriptés** (`npcs` du monde, qu'une mission peut redéfinir par `id`). Un personnage est une liste ordonnée d'intentions : groupes de mots (`words`, sans tenir compte des accents ; un mot de quatre lettres ou plus vaut aussi comme préfixe ; `also` ajoute une seconde liste dont un groupe doit correspondre aussi), familles de techniques reconnues par le moteur (`families` : `override`, `reveal`, `roleplay`, `translation`, `encoding`, `authority`, `completion`, `hypothetical`) et condition `if`. La première intention qui correspond répond, ses réponses s'enchaînent, et `set` mémorise une variable. Ce cerveau scripté (`decide` dans `engine/src/npc.ts`) décide seul de ce qu'un personnage lâche : un cerveau LLM peut l'aider à comprendre le joueur ou reformuler, jamais décider (voir « Interface PNJ »).
- **Parler à un personnage** : bloc `chat` dans une page (fenêtre navigateur) ou `curl -d "message" <route avec chat>`. Les deux passent par `game.chat()`, qui émet `ChatSent` puis `ChatReply { npc, intent, families }`. Les règles des missions réagissent à `ChatReply` (objectif, bruit, message d'Ada). Une réaction de la cible se note `noise.add: { points, as: <clé> }` : elle apparaît alors sous ce texte dans le journal du SOC au débrief. Les solutions des missions utilisent `curl -d`.
- **La garde de périmètre** (`resolveTarget` dans `engine/src/net.ts`) est le passage obligé de toute commande réseau, et du navigateur (`game.browse()`).
- **Sécurité** (détail dans `SECURITY.md`) : toute sortie du terminal passe par `sanitizeTerminal` (seules les couleurs SGR survivent) et xterm n'ouvre aucun lien ; le schéma refuse les caractères de contrôle et les réseaux de périmètre plus larges que leur bloc réservé ; le build épingle l'empreinte des packs officiels dans le code (`__OFFICIAL_PACKS__`) ; la CSP exige Trusted Types, donc jamais d'`innerHTML` ; le mode BYOK est plafonné à `BRAIN_CALL_LIMIT` appels par usage et par onglet.

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

Son : boucle dark-synth lente dont le filtre s'ouvre et l'arpège se densifie avec la jauge de bruit (`setTension`), plus calme derrière le débrief, et courtes signatures sur les événements du moteur (message, objectif, flag, erreur, détection). Rien ne joue avant le premier clic. Interrupteur et volumes séparés dans les réglages.

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
  id: 'webllm' | 'gateway' | 'byok';
  isAvailable(): Promise<boolean>;
  hear?(input: HearInput): Promise<{ words: unknown; families: unknown }>; // filtré par acceptHearing
  reply?(input: {
    npcId: string;            // ex. 'nova', 'theo'
    name: string; role: string; kind: 'human' | 'ai';
    sheet?: string;           // fiche de style du personnage, sans aucun secret
    history: { from: 'player' | 'npc'; text: string }[];
    message: string;
    locale: 'fr' | 'en';
    scripted: string;         // la réplique déjà décidée par le script
  }): Promise<{ text: string }>;
}
```

Un cerveau LLM aide un personnage de deux façons, que le joueur active une par une dans les réglages, chacune avec son modèle et une estimation de coût : **comprendre** ses messages (`hear`) et **reformuler** les répliques (`reply`).

Comprendre : `game.converse` envoie au modèle le message du joueur, le vocabulaire du personnage (`vocabulary(npc)`, groupes de mots normalisés) et les familles de techniques. Le modèle rend un JSON contraint, filtré par `acceptHearing` (`engine/src/npc.ts`) : seuls restent des groupes du vocabulaire et des familles connues. `decide` les ajoute à ce qui a été tapé. Le modèle ne peut donc rien obtenir que le joueur n'aurait pu taper. Une intention `literal: true` (nom, mot de passe à découvrir) ne compte que ce qui est tapé, et ses mots ne partent jamais au modèle. Ce qui a été compris est noté dans `ChatSent.heard`, donc la reprise rejoue sans appel. `curl -d` reste purement scripté.

Reformuler : un cerveau LLM ne fait que donner sa voix à un personnage. `game.converse(npc, message, brain)` laisse d'abord le cerveau scripté décider (`decide`), puis donne au modèle la seule réplique choisie à redire. Le modèle ne connaît donc aucun secret avant que le script ait décidé de le lâcher. Son texte passe par `acceptWording` (`engine/src/brain.ts`) : mêmes flags et mêmes passages entre accents graves que la réplique du script, aucun flag inventé, longueur bornée. Un bloc collé par le personnage (tout ce qui suit la première ligne vide d'une réplique) n'est jamais envoyé au modèle : le moteur le rajoute tel quel. Au moindre doute, erreur, refus ou délai dépassé, la réplique du script est utilisée et le joueur n'est jamais bloqué. Les règles des missions réagissent au même `ChatReply` dans les deux cas.

Le mode BYOK (`apps/game/src/brain.ts`) appelle l'API Anthropic avec le SDK officiel, chargé à la demande, depuis le navigateur du joueur. La clé reste en `sessionStorage` (ou en `localStorage` si le joueur le demande), jamais dans la sauvegarde ni ailleurs. Sans clé, le jeu ne fait aucune requête extérieure. La CSP n'autorise que `https://api.anthropic.com` en plus de l'origine.

## Définition de « fini » pour chaque lot

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm packs:check` et `pnpm build` passent.
- FR et EN complets pour tout nouvel écran.
- Une capture d'écran du rendu est ajoutée dans `docs/screens/` et comparée aux maquettes.
- Le cadre non négociable ci-dessus est respecté.
