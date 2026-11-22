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
2. Dans l'onglet Actions, lancer à la main « Deploy to GitHub Pages ».

GitHub Pages ignore le fichier `_headers`. La politique de sécurité du contenu reste appliquée par la balise meta de `index.html`, mais sans `frame-ancestors`.

## À vérifier après la mise en ligne

- L'écran titre s'affiche, une nouvelle partie démarre, la mission 0 se termine.
- Dans l'onglet réseau du navigateur, aucune requête ne sort du domaine tant qu'aucune clé d'API n'est réglée.
- La console n'affiche aucune erreur de politique de sécurité du contenu.
- La sauvegarde survit à un rechargement de la page.

## Ce qui reste à décider

- Le nom de domaine.
- La passerelle LLM (après la v1) aura son propre déploiement et sa propre origine à ajouter à `connect-src`.
