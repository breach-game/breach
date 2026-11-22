# Déployer BREACH

Le jeu est un site statique : `pnpm build` produit `apps/game/dist`, qui se dépose tel quel sur n'importe quel hébergeur de fichiers. Il n'y a ni serveur de jeu, ni compte, ni base de données. Tous les chemins sont relatifs, donc le site fonctionne aussi bien à la racine d'un domaine que dans un sous-dossier.

Rien n'est publié automatiquement. Les deux voies ci-dessous demandent une action volontaire.

## Voie 1 : Cloudflare Pages

1. Dans Cloudflare, créer un projet Pages relié au dépôt `breach-game/breach`.
2. Commande de build : `pnpm install --frozen-lockfile && pnpm build`. Dossier de sortie : `apps/game/dist`. Variable `NODE_VERSION` : `22`.
3. Brancher le domaine choisi.

Le build écrit un fichier `_headers` que Cloudflare Pages applique : politique de sécurité du contenu en en-tête (avec `frame-ancestors 'none'`, que la balise meta ne peut pas exprimer), `nosniff`, pas de référent, permissions fermées, cache long sur `/assets/` et pas de cache sur le catalogue des packs.

## Voie 2 : GitHub Pages

1. Dans les réglages du dépôt, Pages, choisir la source « GitHub Actions ». Sur un dépôt privé, cela demande une offre GitHub payante, ou de rendre le dépôt public.
2. Dans l'onglet Actions, lancer à la main « Deploy to GitHub Pages », sur la branche `main`.

Le jeu est alors servi à l'adresse https://breach-game.github.io/breach/. Les chemins relatifs suffisent pour ce sous-dossier `/breach/`, aucun réglage de base n'est nécessaire. Pour publier une nouvelle version (une mission ajoutée, par exemple), relancer le même workflow après la fusion sur `main`.

GitHub Pages laisse les navigateurs garder chaque fichier dix minutes. Le catalogue et les packs sont donc demandés avec revalidation, pour qu'un pack reconstruit sous le même nom ne soit pas refusé par l'empreinte épinglée juste après une mise à jour.

GitHub Pages ignore le fichier `_headers`. La politique de sécurité du contenu reste appliquée par la balise meta de `index.html`, mais sans `frame-ancestors`. Pour compenser, le jeu refuse de démarrer quand un autre site l'affiche dans un cadre.

## À vérifier après la mise en ligne

- L'écran titre s'affiche, une nouvelle partie démarre, la mission 0 se termine.
- Dans l'onglet réseau du navigateur, aucune requête ne sort du domaine tant qu'aucune clé d'API n'est réglée.
- La console n'affiche aucune erreur de politique de sécurité du contenu ni de Trusted Types.
- Les packs officiels sont épinglés au build : déposer le catalogue et les packs du même build que le code, sinon le jeu les refuse.
- La sauvegarde survit à un rechargement de la page.

## Ce qui reste à décider

- Le nom de domaine. Pour l'instant, l'adresse par défaut de GitHub Pages suffit.
- La passerelle LLM (après la v1) aura son propre déploiement et sa propre origine à ajouter à `connect-src`.
