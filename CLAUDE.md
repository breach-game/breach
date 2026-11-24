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
- **Les flags** se valident par `submit FLAG{...}`, comparés par empreinte sha256. Jamais par un LLM. Un `FLAG{...}` n'est accepté que si la cible l'a montré au joueur : le moteur note chaque flag qui apparaît dans une sortie de commande, une page, une réplique ou un fichier ouvert dans l'éditeur (événement `FlagShown`, `state.shown`), et refuse les autres sans pénalité. Ce que le joueur tape lui-même ne compte pas. Une réponse simple (adresse, identifiant) n'est pas concernée.
- **Trois niveaux de guidage** choisis par le joueur : Guidé (Ada donne chaque commande), Autonome (Ada donne la direction), Expert (briefing et objectifs seulement). Dans un pack, `ada.say` est du récit, toujours affiché. L'aide passe par deux canaux : la table `guide` de la mission (une phrase d'ouverture par objectif obligatoire, que le moteur donne dès que le premier objectif ouvert n'a pas encore eu d'instruction) et l'effet `ada.guide: { key, for, step }` pour les étapes plus fines à l'intérieur d'un objectif. Une aide n'est jamais donnée pour un objectif déjà atteint ni pour une étape déjà dépassée, donc le joueur peut jouer dans le désordre. En Autonome, le moteur utilise la clé `<clé>.standard` si elle existe.
- **Le score** d'une mission : points des flags, plus 50 par objectif, plus les réponses d'enquête, multipliés par le niveau (Guidé ×1, Autonome ×1,25, Expert ×1,5), moins 10 par indice, 10 par mauvaise réponse à un choix multiple, 25 par détection et 3 par point d'impact. Les points du rejeu défense s'y ajoutent. Le niveau compté est le plus aidé utilisé pendant la mission (`GuidanceChanged`, `state.level`) : demander plus d'aide le baisse pour de bon. `game.scoreDetail()` donne le détail affiché au débrief.
- **Types d'épreuve.** Une mission ne se gagne pas qu'avec des flags. `checks` : des conditions sur l'état du jeu, le plus souvent `{ file, contains, lacks }` sur un fichier du poste (`~` = dossier personnel), jugées par la commande `verify` ; un objectif se termine quand tous ses contrôles passent, ainsi que ceux qui ne nomment aucun objectif (les garde-fous : le fichier doit toujours faire son travail). Le joueur répare avec `sed -i`, une redirection, ou l'éditeur du poste (`edit <fichier>`, fenêtre `os/Editor.tsx`, qui enregistre par `game.writeFile` donc par l'événement `FileWritten`). `questions` : choix multiples qu'Ada pose avec l'effet `ada.ask`, affichés en boutons dans la messagerie et accessibles par `answer` ; la bonne option termine l'objectif, une mauvaise coûte 10 points et affiche son `why`. Les options sont mélangées par le moteur (`game.optionsOf`, ordre fixe pour une question donnée) : ne jamais désigner une option par sa lettre dans un texte, et répondre par identifiant dans `solution.txt` (`answer <id>`). `breach-pack check` refuse une question dont la bonne option dépasse 1,3 fois la plus longue des mauvaises. `submit` accepte aussi une réponse simple (une adresse, un identifiant) si le pack en fait un flag.
- **Écran communautaire en store** (`screens/Community.tsx`, logique pure dans `store.ts`, testée dans `apps/game/test/`) : recherche, collections (incidents réels si `incident`, exemples si id `example.`, joueurs, importées), filtres compétences, difficulté et état, tris, grille ou liste, étagère « Reprendre », badges nouveau et mis à jour (`community:seen`), panneau de détail avec le niveau. Un pack peut donner `incident` (année de l'incident réel) et `minutes` (durée estimée, une série additionne ses missions) ; `breach-pack build --git-dates` ajoute `added` et `updated`. Les entrées du catalogue ignorent les champs inconnus, pour qu'un catalogue plus récent s'ouvre dans un jeu plus ancien : fusionner le jeu avant les packs qui utilisent un nouveau champ.
- **Parcours et défis** : un pack `kind: path` (`pack.yaml` + `path.yaml` avec `steps: [{ ref, note? }]`, de 3 à 20, sans `requires`) propose un ordre à travers des missions ou séries officielles (campagne, saisons, entraînements) et communautaires ; `breach-pack check` vérifie que chaque étape existe. Le store les range dans « Parcours » (`resolveSteps`, `pathProgress` dans `store.ts`) : une étape faite dans n'importe quelle sauvegarde compte, et « Ouvrir » mène à l'écran où elle se joue. Un pack peut limiter ses niveaux de guidage (`levels: [expert]` pour un défi, collection « Défis ») : le moteur ramène le niveau demandé au plus proche permis (`allowedLevel`), le réglage du joueur ne change pas, et la barre d'état grise les autres niveaux.
- **Importer une mission depuis un fichier** : `breach-pack bundle <dossiers…> --out x.breachbundle` rassemble les packs et leurs solutions (`bundleSchema`). Le jeu (`local.ts`, `localStore.ts`) refait les contrôles de la CI communautaire dans le navigateur (`@breach/pack-cli/check`, sans accès disque : schéma, sécurité, ids, rejeu de chaque solution dans chaque langue), refuse un id du catalogue signé, garde le fichier dans IndexedDB sur ce poste seulement, l'affiche dans « Importées » avec le badge ambre « Non relue », et le sauvegarde à part (`save:local:<id>@<version>-<sha256 du fichier>`). Jamais présenté comme relu.
- **Séries** : un pack `kind: series` (`pack.yaml` + `series.yaml` avec la liste `missions`, de 2 à 12) enchaîne des missions d'un même monde, dans l'ordre listé et dans une seule sauvegarde (`save:community:<id de la série>@<version>`), donc ce que le joueur a fait dans une mission existe encore dans la suivante. `breach-pack check` vérifie que les missions existent, partagent le monde, ont des `order` croissants, et rejoue leurs solutions à la suite dans une seule partie. L'écran communautaire liste les séries en premier (`seriesMissions`, `seriesProgress`), cache leurs missions de la liste à plat, et propose commencer, continuer ou recommencer. Le dernier débrief donne le score de la série.
- **Fiche « ce qui s'est vraiment passé »** : `debrief.facts` (`title`, `points`, `sources: [{ label, url }]`) raconte l'incident réel dont une mission s'inspire, après la fiction. Les missions gardent des noms fictifs ; seule cette fiche nomme l'entreprise. Les adresses des sources sont le seul endroit où un pack peut écrire un vrai domaine : `https` simple imposé par le schéma, affichées en texte, jamais en lien. Ne jamais nommer une personne privée.
- **Saisons** : séries officielles jouées après la campagne, chacune dans son propre monde (`content/worlds/<nom>`, `content/missions/s2-*`…). Saison 2 : Halcyon (chaîne de fabrication). Saison 3 : Pélican (`content/worlds/pelican`, `content/missions/s3-*`), une boutique en ligne et les failles classiques du web. Saison 4 : Ville de Corbelle (`content/worlds/corbelle`, `content/missions/s4-*`), une mairie sous rançongiciel, jouée entièrement côté défense. Saison 5 : Sélène (`content/worlds/selene`, `content/missions/s5-*`), une plateforme qui loue des équipes d'agents IA : index de documents partagé, mémoire empoisonnée, paquet inventé par un agent, usurpation entre agents. Saison 6 : Alto (`content/worlds/alto`, `content/missions/s6-*`), une start-up hébergée tout entière chez Nimbus, un cloud fictif dont le stockage et les identités sont des routes web scriptées : seau public, jeton de pipeline dans un journal, rôle trop large, application autorisée par un employé (mission défense). Saison 7 : Festival Lumière Noire (`content/worlds/lumiere`, `content/missions/s7-*`), un programme de bug bounty sur une billetterie : le règlement du programme sert de mandat (une preuve suffit, les vrais billets coûtent du bruit), faille de logique entre transfert et remboursement, rapport de divulgation jugé par `verify` puis décision de publication, et hameçonnage vu côté défense (mission défense, journal `mail`). Saison 8 : Verdure (`content/worlds/verdure`, `content/missions/s8-*`), une ferme verticale et ses objets connectés : le courtier de messages est un hôte dont les routes sont des sujets (commande `mqtt`), ouvert à tous en lecture puis en écriture (preuve sur le banc d'essai seulement, les serres en production coûtent du bruit), clé d'usine commune lue à côté du micrologiciel, et intrus qui donne des ordres sous le nom d'un capteur (mission défense, journal `mqtt`). Saison 9, la finale : Silence (`content/worlds/lignerouge`, `content/missions/s9-*`), jouée entièrement côté défense et sans commande nouvelle : Mute se connecte chez Ligne Rouge par un compte de stagiaire jamais fermé, sur le serveur qui garde les rapports de tous les clients ; fermer le compte, puis assembler les six cartes de visite (chaque monde des saisons 3 à 8 sert une route `/m.txt` dont le morceau, mis bout à bout avec les autres, épelle le nom du compte), écrire deux règles de détection, un garde-fou d'agent et une revue de comptes, rendre un rapport d'incident jugé par `verify` et décider comment prévenir les clients. Mute n'est jamais nommé ni arrêté : on attribue à une signature, pas à une personne. Les missions portent `track: season`, la série est un pack `kind: series` officiel (`breach.season2`…). Le catalogue les liste à part dans `seasons` ; l'écran `screens/Seasons.tsx` les propose depuis l'écran titre (bouton « Saisons »), chaque saison a sa propre sauvegarde (`save:season:<id>@<version>`) et se joue comme la campagne, au niveau de guidage des réglages. Le dernier débrief donne le score de la saison. Comme il y a désormais plusieurs mondes officiels, les tests qui rejouent une mission résolvent son monde par `requires[0]`.
- **Parcours entre les saisons** (`apps/game/src/journey.ts`, logique pure testée dans `apps/game/test/journey.test.ts`) : la campagne est la saison 1, puis viennent les `seasons` du catalogue. `loadJourney()` (`session.ts`) lit la progression de chaque sauvegarde ; `nextStep` dit quoi faire ensuite (reprendre une saison en cours, commencer la première jamais jouée, ou tout est terminé). L'écran titre l'affiche en carte « prochaine étape », l'écran Saisons en cartes d'avancement, et le dernier débrief d'une saison propose la suivante en un clic (ou, si tout est fini, la communauté et les entraînements). Les nouveautés (saison, mission ajoutée à une saison connue, entraînement) se décident sur ce poste seulement, par comparaison avec `news:seen` dans IndexedDB : aucun suivi. Un nouveau joueur n'a aucune nouveauté ; un joueur qui revient apprend les saisons qu'il n'a jamais ouvertes.
- **Entraînements** : missions officielles courtes hors campagne (`track: training` dans `pack.yaml`, dossiers `content/trainings/`), avec `difficulty` (1 à 3) et `skills`. Le catalogue les liste dans `training`, l'écran `screens/Training.tsx` les affiche toujours ouverts, et chacun se joue comme une mission rejouée (`save:replay:<id>@<version>`).
- **Valider une mission à la main** : `pnpm --filter @breach/pack-cli exec tsx scripts/qa.ts guided <id> none "cmd ;; cmd"` affiche ce que dit Ada après chaque commande. À faire aux trois niveaux, dans l'ordre prévu et dans le désordre.
- **Les pages web sont des blocs déclaratifs** (`page: { title, blocks }` sur une route : `h1`, `h2`, `p`, `list`, `code`, `nav`, `link`, `comment`, `chat`, `footer`, `table: { head, rows }`, `form: { to, label, button, name }`). Le navigateur du poste les dessine lui-même, et `curl` comme « Voir la source » affichent le HTML que le moteur en déduit (`pageHtml`). Un pack ne fournit jamais de balisage. Un bloc `comment` n'existe que dans la source.
- **Formulaires web** : un formulaire est un personnage scripté sans visage. Le bloc `form` désigne par `to` le personnage qui répond, et la route qui porte `chat: <ce personnage>` reçoit `curl -d "champ=valeur"` ; le formulaire du navigateur (`os/PageForm.tsx`) et `curl -d` passent tous deux par `game.chat()`. Une route dont la page contient un tel formulaire répond en texte brut, pas en JSON. Une intention peut exiger une forme d'entrée avec `input: [quote | markup | negative]` (`inputShapes` dans `engine/src/npc.ts` : un guillemet qui n'est pas une apostrophe dans un mot, une balise, un nombre négatif) : c'est la classe de faille qui est reconnue, jamais un payload précis. Le contrôle de sécurité des packs refuse toujours `<script`, `javascript:` et les attributs `on…=`.
- **Variantes d'une route** : `variants: [{ id, cookie?, header?, if?, … }]` sert une autre réponse quand la requête porte ce cookie (`curl -b`) ou cet en-tête (`curl -H`), et que la condition `if` tient (une faille corrigée par `sets` ferme la variante). Une variante peut n'avoir qu'une condition `if`, sans cookie ni en-tête : elle répond alors à toute requête, dans le navigateur aussi, tant que la condition tient (un seau rendu privé, une page qui change après une action). La première variante qui correspond gagne ; l'événement `HttpRequest` note son `id` dans `variant`, pour les règles.
- **Relecture de code** : `reviews: [{ id, file, lines, objective }]` dans une mission. `review <fichier>` affiche le fichier numéroté, `review <fichier> <ligne>` désigne une ligne fautive (événement `Reviewed`, `state.reviewed`) ; une erreur coûte 10 points comme une mauvaise réponse, et l'objectif se termine quand toutes les lignes sont trouvées.
- **Commandes de données** (`engine/src/commands/data.ts`) : `jq` (chemins, `[]`, `keys`, `length`, `|`, `-r`, `-c`) et `jwt decode`, qui ne fait que lire un jeton : il ne signe ni ne fabrique rien.
- **Les personnages sont scriptés** (`npcs` du monde, qu'une mission peut redéfinir par `id`). Un personnage est une liste ordonnée d'intentions : groupes de mots (`words`, sans tenir compte des accents ; un mot de quatre lettres ou plus vaut aussi comme préfixe ; `also` ajoute une seconde liste dont un groupe doit correspondre aussi), familles de techniques reconnues par le moteur (`families` : `override`, `reveal`, `roleplay`, `translation`, `encoding`, `authority`, `completion`, `hypothetical`) condition `if` et `above: "1.4.2"` (le message tapé doit donner un numéro de version plus haut, lu après le mot « version » ; jamais déduit par un modèle). La première intention qui correspond répond, ses réponses s'enchaînent, et `set` mémorise une variable. Ce cerveau scripté (`decide` dans `engine/src/npc.ts`) décide seul de ce qu'un personnage lâche : un cerveau LLM peut l'aider à comprendre le joueur ou reformuler, jamais décider (voir « Interface PNJ »).
- **Parler à un personnage** : bloc `chat` dans une page (fenêtre navigateur) ou `curl -d "message" <route avec chat>`. Les deux passent par `game.chat()`, qui émet `ChatSent` puis `ChatReply { npc, intent, families }`. Les règles des missions réagissent à `ChatReply` (objectif, bruit, message d'Ada). Une réaction de la cible se note `noise.add: { points, as: <clé> }` : elle apparaît alors sous ce texte dans le journal du SOC au débrief. Les solutions des missions utilisent `curl -d`.
- **Télémétrie** (`engine/src/telemetry.ts`) : le moteur dérive du journal des lignes de log au format de l'outil réel (`access`, `auth`, `chat`, `agent`, `dns`, `ids`, `audit`, `git`, `db`, `flow`, `mail`, `mqtt`), avec la vraie IP source à travers les rebonds SSH, plus un trafic de fond déterministe (`telemetry.background` du monde, `background` d'une mission). **Toute nouvelle commande réseau déclare la télémétrie qu'elle laisse**, sinon le rejeu défense devient faux.
- **Failles en données** : `config` (monde, puis mission) et condition `{ config, eq }` sur une intention, un commit, un flag ou une étape d'attaquant. Un correctif ou un confinement est un `sets`, journalisé par `ConfigPatched`.
- **Rejeu défense** (bloc `defense` d'une mission d'attaque, `os/Defense.tsx`) : retrouver ses lignes (`markLines`), choisir la règle de détection (`chooseRule`, format proche de Sigma, `runDetection`), choisir le correctif (`applyFix`, qui rejoue l'attaque du joueur dans deux bacs à sable via `replayWith`). Un flag ne compte dans le rejeu que s'il est d'abord apparu dans une sortie. Obligatoire pour passer à la mission suivante de la campagne ; ses points s'ajoutent au score. `breach-pack check` vérifie que la bonne règle n'a pas de faux positif et que seul le bon correctif bloque la solution.
- **Missions défense** (`side: defense`, `content/missions/b0*`) : un `adversary` scripté avance d'une étape toutes les `pace` lignes du joueur ; le joueur utilise `soc`, `contain` (coût d'impact, −3 points par point) et `answer <id> <valeur>` (questions d'enquête du champ `investigation`, empreinte sha256 de la réponse normalisée ; la même commande sert aux choix multiples). Une étape `blockedIf` bloquée arrête l'attaquant, sauf `continueIfBlocked`, et laisse une ligne `flow: deny` dans les journaux. `mission.fail` ramène au point de reprise. La commande `report` écrit le rapport de pentest depuis le journal.
- **Décisions** : une question sans `correct` est une décision. Aucune option n'est fausse : chacune peut porter `impact` (coût pour l'organisation, −3 points par point comme un confinement) et `sets` (réglages de la cible), termine l'objectif, et reste notée dans `state.choices`, qui n'est jamais remis à zéro. Une mission suivante de la même sauvegarde la relit avec la condition `{ choice: <question>, eq: <option> }` (fins à embranchements). `breach-pack check` rejoue la solution une fois par option : chaque branche doit finir.
- **Mesures de défense qui changent des fichiers** : une mesure `contain` (actions `block`, `revoke`, `isolate`, `disable`, `reset`, `remove`, `restore`, `rotate`) peut réécrire (`writes`) ou supprimer (`removes`, événement `FileRemoved`) des fichiers d'un hôte, pour que la machine montre ce qui a été fait. Une mission défense n'a pas besoin d'attaquant si elle a des mesures ou des questions ; `mission.fail` y ramène au dernier `checkpoint.save`.
- **Règles de détection écrites par le joueur** : `hunts: [{ id, file, catch: { source, where }, objective }]` dans une mission. Le joueur écrit la règle dans un fichier de son poste (`source: auth`, puis un champ par ligne, avec `|contains`, `|startswith`, `|endswith` ; `parseRule` dans `engine/src/commands/defense.ts`) et l'essaie avec `rule test <fichier>` (événement `RuleTested`). Elle passe quand elle alerte sur chaque ligne de l'attaquant que `catch` désigne et sur aucune ligne de l'activité ordinaire. Le juge est `runDetection`, jamais un modèle.
- **Garde-fous écrits par le joueur** : `evals: [{ id, file, cases: [{ id, text, fields, expect: block | allow }], objective }]` dans une mission. Le joueur écrit le garde-fou d'un agent dans un fichier de son poste, une condition par ligne (mêmes modificateurs que les règles de détection, plus `|gte`, sans ligne `source`), et l'essaie avec `eval run <fichier>` (événement `EvalRun`). Un appel d'outil est bloqué quand il remplit toutes les conditions ; le garde-fou passe quand il bloque chaque cas `block` et aucun cas `allow`. Le juge est `game.runEval`, jamais un modèle.
- **`mqtt sub|pub`** (`engine/src/commands/network.ts`) : client du courtier de messages d'objets connectés. Un sujet est une route de l'hôte qui porte un service `mqtt` (`/verdure/serre/#`) : `mqtt sub -h <hôte> -t <sujet> [-u compte -P mot de passe]` affiche les messages retenus de la route (ses `variants` s'appliquent, le compte arrive comme en-tête `Authorization: compte:mot de passe`, un statut 401 ou 403 refuse la connexion), `mqtt pub … -m <message>` remet le message au personnage `chat` de la route, comme `curl -d`. Les règles voient un `HttpRequest` de méthode `SUBSCRIBE` ou `PUBLISH`, la télémétrie écrit une ligne `mqtt` et aucune ligne `access` ni `chat`. Rien ne reste abonné : la commande lit le pack et rend la main.
- **`crontab -l [-u compte]`** lit les tâches planifiées de la machine de la session (`/var/spool/cron/crontabs/<compte>`). Lecture seule.
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
