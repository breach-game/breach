# Lot 0 — la tranche verticale

À coller dans Claude Code depuis la racine du projet.

---

Lis `CLAUDE.md` et `docs/GDD.md`, puis regarde les maquettes dans `docs/mockups/` (`Boot.dc.html`, `Main.dc.html`). Nous construisons le lot 0 de BREACH : une tranche verticale très courte mais déjà très belle.

## Objectif

Un joueur ouvre le site, voit l'écran titre, lance une nouvelle partie, arrive sur le bureau LR-OS et termine la mission 1 (« Empreinte ») dans le terminal, en français ou en anglais.

## Périmètre

1. **Initialisation** : Vite + React + TypeScript strict, pnpm, Vitest, ESLint, Prettier, i18next (FR et EN), tokens de `CLAUDE.md` dans `src/theme/tokens.css`, polices Google Fonts.
2. **Écran titre** fidèle à `docs/mockups/Boot.dc.html` : logo BREACH avec glitch, lignes de boot, choix de langue, sélecteur du cerveau des PNJ (seul « Scripté » est actif dans ce lot, les autres sont grisés avec « bientôt »).
3. **Bureau LR-OS** fidèle à `docs/mockups/Main.dc.html` : barre de statut (mission, jauge de bruit, horloge du jeu), fenêtres déplaçables et redimensionnables, au minimum le terminal, la messagerie d'Ada et le carnet d'objectifs. La carte réseau peut rester en 2D (SVG) pour ce lot.
4. **Terminal** avec xterm.js : prompt `ada@lignerouge:~$`, historique, autocomplétion Tab, pipe vers `grep` et `head`. Commandes : `help`, `whoami`, `ls`, `cd`, `cat`, `grep`, `head`, `clear`, `dig`, `whois`, `curl`, `git log`, `git show`, `explain`, `hint`, `notes`.
5. **Monde simulé et moteur de missions** chargés depuis `content/missions/m01-empreinte.yaml` : hôtes, fichiers, objectifs, flags, indices, coût en bruit de chaque commande. Toute cible hors `*.novamind.test` est refusée avec le message d'Ada sur le mandat.
6. **Ada** en mode scripté : messages déclenchés par les événements de la mission (début, objectif atteint, bruit élevé, flag trouvé, fin).
7. **Débrief défense** de fin de mission : un écran court qui explique la parade (réduire l'exposition, scanner les secrets dans l'historique Git).
8. **Sauvegarde** de la progression dans IndexedDB.

## Hors périmètre pour ce lot

Carte 3D, son, LLM (WebLLM, passerelle, BYOK), mode Blue Team, missions 2 à 6.

## Exigences

- Tests Vitest pour le parseur, chaque commande et la validation des flags.
- Aucune chaîne visible en dur : tout est dans `src/i18n/fr.json` et `en.json`.
- `prefers-reduced-motion` respecté, interrupteur « effets » dans un petit menu réglages.
- À la fin : `pnpm build` et `pnpm test` verts, et des captures de l'écran titre et du bureau dans `docs/screens/`.

Commence par me proposer un plan court (fichiers et étapes), puis implémente étape par étape en lançant les tests à chaque fois.
