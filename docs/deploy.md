# Déployer BREACH

Le jeu est un site statique : `pnpm build` produit `apps/game/dist`, qui se dépose tel quel sur n'importe quel hébergeur de fichiers. Il n'y a ni serveur de jeu, ni compte, ni base de données. Tous les chemins sont relatifs, donc le site fonctionne aussi bien à la racine d'un domaine que dans un sous-dossier.

Sur GitHub Pages, le jeu est publié automatiquement après chaque fusion sur `main` (voie 2). Une modification qui ne touche que la documentation ne publie rien. Cloudflare Pages (voie 1) publie selon ses propres réglages.

## Voie 1 : Cloudflare Pages

1. Dans Cloudflare, créer un projet Pages relié au dépôt `breach-game/breach`.
2. Commande de build : `pnpm install --frozen-lockfile && pnpm build`. Dossier de sortie : `apps/game/dist`. Variable `NODE_VERSION` : `26`.
3. Brancher le domaine choisi.

Le build écrit un fichier `_headers` que Cloudflare Pages applique : politique de sécurité du contenu en en-tête (avec `frame-ancestors 'none'`, que la balise meta ne peut pas exprimer), `nosniff`, pas de référent, permissions fermées, cache long sur `/assets/` et pas de cache sur le catalogue des packs.

## Voie 2 : GitHub Pages

1. Dans les réglages du dépôt, Pages, choisir la source « GitHub Actions ». Sur un dépôt privé, cela demande une offre GitHub payante, ou de rendre le dépôt public.
2. Fusionner sur `main` : le workflow « Deploy to GitHub Pages » teste, construit et publie. On peut aussi le lancer à la main depuis l'onglet Actions, sur la branche `main`.

Le jeu est alors servi à l'adresse https://breach-game.github.io/breach/. Les chemins relatifs suffisent pour ce sous-dossier `/breach/`, aucun réglage de base n'est nécessaire. Une nouvelle version (une mission ajoutée, par exemple) part donc en ligne dès sa fusion sur `main`.

GitHub Pages laisse les navigateurs garder chaque fichier dix minutes. Le catalogue et les packs sont donc demandés avec revalidation, pour qu'un pack reconstruit sous le même nom ne soit pas refusé par l'empreinte épinglée juste après une mise à jour.

GitHub Pages ignore le fichier `_headers`. La politique de sécurité du contenu reste appliquée par la balise meta de `index.html`, mais sans `frame-ancestors`. Pour compenser, le jeu refuse de démarrer quand un autre site l'affiche dans un cadre.

## Ce que vit un joueur pendant une mise à jour

Rien ne recharge la page d'un joueur en pleine partie : il continue sur la version qu'il a chargée, et la nouvelle arrive à sa prochaine visite ou à son prochain rechargement.

- **Sa sauvegarde.** Elle note la version du monde et de chaque mission. Si la mise à jour ne change ni le monde ni la mission en cours, la partie reprend exactement où elle en était. Sinon, les missions terminées et leurs scores sont gardés, la mission en cours reprend à son début, et Ada le dit au joueur. Le moteur décide avec `planResume` (`packages/engine/src/progress.ts`). Changer la version d'un pack quand une modification rend ses anciennes sauvegardes incohérentes (objectifs, règles, fichiers) ; une correction de texte n'en a pas besoin.
- **Une page restée ouverte sur l'ancienne version.** Les écrans chargés à la demande (démarrage, bureau, missions de la communauté) ont des noms de fichiers qui changent à chaque build, et le catalogue des packs change avec eux. Une page chargée avant la mise à jour ne les trouve plus : au lieu d'une page blanche, le jeu affiche « Une nouvelle version de BREACH est en ligne » avec un bouton qui enregistre la partie puis recharge la page.
- **Changer de navigateur.** Depuis l'écran titre, le joueur peut télécharger sa progression (missions terminées et scores, dans un petit fichier JSON) et l'importer ailleurs. Le fichier importé est vérifié strictement (`parseProgressFile`) ; une mission en cours n'y figure pas et reprend à son début.

## À vérifier après la mise en ligne

- L'écran titre s'affiche, une nouvelle partie démarre, la mission 0 se termine.
- Dans l'onglet réseau du navigateur, aucune requête ne sort du domaine tant qu'aucune clé d'API n'est réglée.
- La console n'affiche aucune erreur de politique de sécurité du contenu ni de Trusted Types.
- Les packs officiels sont épinglés au build : déposer le catalogue et les packs du même build que le code, sinon le jeu les refuse.
- La sauvegarde survit à un rechargement de la page.
- « Missions de la communauté » affiche le catalogue de `breach-game/packs` (publié par le dépôt `packs` lui-même, avec sa signature). C'est la seule requête vers une autre adresse, et seulement à l'ouverture de cet écran.

## Ce qui reste à décider

- Le nom de domaine. Pour l'instant, l'adresse par défaut de GitHub Pages suffit.
- La passerelle LLM (après la v1) aura son propre déploiement et sa propre origine à ajouter à `connect-src`.
