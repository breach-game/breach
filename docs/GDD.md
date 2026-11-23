# BREACH — Game Design Document

Copie locale au 21 novembre 2026. Version vivante, avec les schémas : https://claude.ai/artifact/LxRR4mbsTq5oRgqeECdhZj

## Pitch

BREACH est un thriller narratif jouable dans le navigateur. Le joueur, pentesteur junior sous mandat, attaque une start-up fictive truffée d'IA, puis rejoue chaque étape côté défense. La v1 vise 6 missions de 20 à 30 minutes, plus une mission tutoriel.

La promesse : apprendre comment une attaque moderne se déroule vraiment, y compris contre des chatbots et des agents IA, pour savoir s'en protéger.

**Piliers de design**

- **Vrai geste, faux monde** : des commandes et des sorties réalistes, mais uniquement sur des machines fictives.
- **Chaque attaque a sa parade** : aucune mission ne se termine sans le débrief côté défense.
- **L'IA est à la fois cible et personnage** : chatbot client, agents internes, collègues joués par un LLM.
- **Beau comme une série** : interface diégétique, chaque écran mérite une capture.
- **Zéro friction** : un lien, 30 secondes, et on joue. Aucun compte ni installation.

## Public et cadre

Le jeu vise les 16 ans et plus, sans prérequis : des ados attirés par la cyber, des étudiants, et des salariés en sensibilisation. Le ton est celui d'un thriller avec de l'humour, sans violence.

- **Toujours sous mandat** : la mission 0 fait signer un contrat de pentest (périmètre, dates, règles d'engagement).
- **La loi dans l'histoire, pas en pop-up** : une action hors périmètre est bloquée par Ada, qui explique l'article 323-1 du Code pénal.
- **Aucune cible réelle** : uniquement des domaines réservés (`.test`, `.example`) et des adresses privées fictives.
- **Des classes de failles, pas des exploits** : OWASP Top 10 et OWASP LLM Top 10. Rien de réutilisable tel quel.
- **Une fin qui ouvre des portes** : Root-Me, TryHackMe, les CTF, le bug bounty et les métiers de la cyber.

## Boucle de jeu

Brief d'Ada → reconnaissance et attaque (terminal, PNJ, chatbot) → repéré par le SOC ? Si oui, retour au dernier checkpoint. Sinon : flag validé par le jeu → débrief défense → rejouer en Blue Team (retrouver ses traces dans les logs) → rapport → mission suivante.

**En Blue Team, le joueur :**

- ouvre la console du SOC et retrouve ses propres actions dans les logs, avec horodatage ;
- choisit la règle de détection qui aurait déclenché l'alerte, parmi trois propositions ;
- corrige la configuration fautive, puis rejoue l'attaque pour vérifier qu'elle échoue.

## Univers et missions

Le joueur rejoint Ligne Rouge, un petit cabinet lyonnais de tests d'intrusion. Son premier client est NovaMind, une start-up qui vend des assistants IA aux cliniques vétérinaires. À partir de la mission 4, il trouve des traces qui ne sont pas les siennes : un vrai groupe, « Mute », est déjà dans le système.

**Personnages** : Ada (red teameuse senior, mentore), les employés de NovaMind (support, RH, développeur, CTO), le chatbot Nova et les agents internes, Mute (jamais vu, seulement ses traces).

| # | Mission | Étape d'attaque | Ce que fait le joueur | Leçon côté défense |
| --- | --- | --- | --- | --- |
| 0 | Le mandat | Cadrage | Lire le contrat, découvrir le bureau, premières commandes | Pourquoi un périmètre et une autorisation écrite |
| 1 | Empreinte | Reconnaissance (OSINT) | Site, offres d'emploi, DNS, dépôt Git avec un secret dans l'historique | Réduire son exposition, scanner les secrets |
| 2 | Le stagiaire bavard | Ingénierie sociale | Obtenir une info d'un employé du support joué par un PNJ | Procédures de vérification, sensibilisation |
| 3 | Nova en sait trop | Prompt injection directe | Faire révéler au chatbot son prompt système puis une donnée client | Séparer instructions et données, filtrer la sortie |
| 4 | Le CV piégé | Prompt injection indirecte (RAG) | Déposer un CV contenant des instructions cachées, lu par l'agent RH | Nettoyer les entrées, isoler le contexte, validation humaine |
| 5 | Trop de pouvoir | Agent trop privilégié, escalade | Pousser un agent interne à utiliser un outil avec des droits admin | Moindre privilège, confirmations, périmètre des outils |
| 6 | Sur les traces de Mute | Mouvement latéral, exfiltration | Suivre Mute de machine en machine, lire les logs | Segmentation, détection, réponse à incident |

Chaque mission d'attaque se termine par un rejeu défense : le joueur retrouve ses propres lignes dans les journaux, choisit la règle de détection, puis le correctif, que le moteur vérifie en rejouant son attaque.

La campagne se poursuit par trois missions Blue Team, où le joueur tient le SOC pendant qu'un attaquant scripté avance :

| # | Mission | Ce que fait le joueur | Leçon |
| --- | --- | --- | --- |
| 7 | Mute revient | Lire les journaux en direct, choisir le confinement le plus étroit | Contenir sans tout couper, mesurer l'impact métier |
| 8 | Atlas sous influence | Arrêter un agent IA manipulé, puis défaire ce qu'il a déjà fait | Un agent compromis laisse des actions, pas seulement des messages |
| 9 | La clé du partenaire | Révoquer une clé d'API qui a fuité plutôt que bloquer une adresse | Traiter la cause, pas le symptôme |

L'épilogue, après la mission 9, génère le rapport de pentest du joueur à partir de ses actions réelles.

### Après la campagne

- **Entraînements** : missions courtes, une technique chacune, toujours ouvertes (lire un journal, encodé n'est pas chiffré, le script modifié, le mail suspect).
- **Saisons** : séries officielles dans de nouvelles entreprises. La campagne NovaMind est la saison 1. La saison 2 audite la chaîne de fabrication de Halcyon (reconnaissance, confusion de dépendances, défense). La saison 3 audite Pélican, une boutique en ligne, avant ses soldes : les failles classiques du web (ce qu'un site laisse voir, injection, balise enregistrée et assistant qui la recopie, sessions devinables, logique métier), chacune avec sa parade. Elle apporte les formulaires et tableaux dans les pages, les cookies de `curl`, les commandes `jq`, `jwt decode` et `review` (relecture de code : désigner les lignes fautives).
- **Missions de la communauté** : packs du dépôt `breach-game/packs`, validés et signés. Les « Dossiers » y sont de courtes séries inspirées d'incidents réels documentés publiquement : entreprise fictive, joueur sous mandat, et une fiche finale sourcée « ce qui s'est vraiment passé » qui ne nomme jamais une personne privée.

### Types d'épreuve

Une mission ne se gagne pas qu'avec des flags : réparation d'un fichier jugée par `verify`, question à choix multiples posée par Ada (options mélangées, mauvaises réponses expliquées), réponse courte, enquête dans les journaux. Un flag ne compte que si la cible l'a montré au joueur.

## Terminal simulé

Interpréteur maison rendu avec xterm.js, prompt `ada@lignerouge:~$`. Parseur d'arguments, autocomplétion Tab, historique, pipes simples (`| grep`, `| head`, `| wc`). Système de fichiers virtuel par machine, réseau d'hôtes `*.novamind.test`. Sorties au format réel, latence simulée, erreurs authentiques. Toute cible hors périmètre est refusée.

| Commande | Usage en jeu |
| --- | --- |
| `whoami` `ls` `cd` `cat` `grep` `find` | Explorer les machines et lire les fichiers |
| `dig` `whois` | Reconnaissance DNS |
| `nmap` | Découvrir hôtes et services |
| `curl` | Interroger le site, l'API et le chatbot |
| `git log` `git show` | Retrouver un secret dans l'historique |
| `ssh` `scp` | Se déplacer entre machines |
| `john` | Casser un mot de passe faible |
| `tail` `less` sur `/var/log` | Lire les logs, repérer Mute et ses propres traces |

Commandes de jeu : `explain <cmd>` (l'outil et comment un défenseur le détecte), `hint` (trois niveaux), `notes` et `report`.

**Discrétion** : une jauge de bruit monte avec chaque action visible. Au maximum, le SOC détecte le joueur et la mission repart d'un checkpoint.

## PNJ et IA

Tout le jeu doit pouvoir se finir sans LLM. Les quatre modes passent par l'interface `NpcBrain`.

| Mode | Fonctionnement | Pour qui | Coût |
| --- | --- | --- | --- |
| Scripté (défaut) | Arbres de dialogue et reconnaissance d'intentions | Tout le monde | Gratuit |
| Modèle local | WebLLM et WebGPU dans le navigateur | Machines récentes | Gratuit, 1 à 2 Go |
| Passerelle BREACH | FreeLLMAPI sur le VPS derrière une API à quotas | Tout le monde, avec quota | Gratuit pour le joueur |
| BYOK | Appel direct à Anthropic, OpenAI ou OpenRouter | Adultes, curieux | Payé par le joueur |

- Une fiche par PNJ : personnalité, ce qu'il sait, ce qu'il ne doit pas dire, failles volontaires selon la difficulté.
- Juge déterministe : le jeu vérifie lui-même la présence du flag. Jamais le LLM.
- Monde clos : chaque PNJ reste dans NovaMind et refuse d'aider sur des cibles réelles.
- BYOK : clé en session par défaut, CSP stricte, recommandation d'une clé dédiée avec plafond.
- Passerelle : voir `gateway/README.md`.

## Direction artistique

Thriller néon diégétique : l'écran est le poste du pentesteur, un OS fictif nommé LR-OS. Références d'ambiance : l'UI de *Mr. Robot*, la lumière de *Blade Runner 2049*, la lisibilité de *Hacknet*. Palette, typos et règles : voir `CLAUDE.md`. Maquettes : `docs/mockups/`.

**Cinq moments « wow »**

1. Le premier démarrage : boot de LR-OS, puis Ada qui écrit « Bienvenue chez Ligne Rouge ».
2. Le premier `nmap` : la carte 3D s'allume machine par machine.
3. Le chatbot qui cède : sa fenêtre glitch, son violet vire au rouge.
4. La détection : bords d'écran rouges pulsants, alarme sourde, compte à rebours.
5. La bascule Blue Team : rembobinage façon VHS, puis toute l'interface passe au cyan.

**Accessibilité** : `prefers-reduced-motion`, interrupteur des effets, contraste AA, taille du terminal réglable, jamais d'information par la couleur seule.

## Son

Musique générée en direct avec Tone.js (darksynth calme, qui monte avec le bruit), sons d'interface, signatures sonores (flag, détection, traces de Mute), volumes séparés.

## Architecture

Site statique (Cloudflare Pages ou GitHub Pages) : aucun serveur de jeu, aucun compte. Connexions externes optionnelles : la passerelle LLM sur le VPS, ou l'appel direct en BYOK. Stack : React, Vite, TypeScript, xterm.js, react-three-fiber, GSAP, Tone.js, WebLLM, IndexedDB.

**Domaines libres au 21/11/2026** : `breachgame.fr`, `playbreach.fr` (environ 5 € HT la première année chez OVHcloud), `breachgame.dev`, `playbreach.dev` (18,59 € TTC par an), `breachgame.app`.

## Roadmap

1. **Lot 0** : tranche verticale (écran titre, bureau, terminal, mission 1, FR et EN).
2. **Lot 1** : moteur de missions en YAML, bruit, carnet, sauvegarde.
3. **Lot 2** : carte 3D et effets, les cinq moments « wow ».
4. **Lot 3** : PNJ scriptés, missions 2 et 3.
5. **Lot 4** : couche LLM (WebLLM, passerelle, BYOK).
6. **Lot 5** : missions 4 à 6, Mute, Blue Team, rapport.
7. **Lot 6** : son, accessibilité, relecture des traductions, performance.
8. **Lot 7** : tests de jeu et publication.

## Décisions

- Titre : BREACH. Langues : FR et EN dès la v1. Licence : MIT. Hébergement statique gratuit.
- Encore ouvert : nom de domaine, quota de la passerelle, VPS avec FreeLLMAPI ou Cloudflare Workers.
