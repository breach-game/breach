# Passerelle LLM BREACH

Service optionnel qui donne aux joueurs des dialogues libres avec les PNJ, gratuitement et avec un quota. Il tourne sur le VPS, jamais sur le serveur de la maison.

## Principe

```
navigateur ──► API BREACH (VPS) ──► FreeLLMAPI (VPS, réseau privé) ──► fournisseurs gratuits
```

- FreeLLMAPI n'est jamais exposé sur Internet : il écoute uniquement sur le réseau Docker interne. Le projet est conçu pour un seul utilisateur.
- L'API BREACH est la seule porte d'entrée publique.

## Contrat

`POST /v1/npc/reply`

```json
{ "npcId": "nova", "locale": "fr", "history": [...], "message": "..." }
```

- Le client n'envoie jamais de prompt système. Le serveur charge la fiche du PNJ (`npcs/<npcId>.yaml`) et construit le prompt lui-même. La passerelle ne peut donc pas servir de chatbot généraliste.
- Réponse : `{ "text": "...", "remaining": 37 }`. Quota épuisé : HTTP 429, et le jeu repasse en mode scripté.

## Protections

- **Jeton anonyme** par navigateur, délivré par `POST /v1/session` après un captcha invisible Cloudflare Turnstile. Aucun compte, aucune donnée personnelle.
- **Quotas** : messages par jeton et par jour (40 au départ), limite par IP, plafond global quotidien.
- **Limites** : longueur du message entrant, historique tronqué, `max_tokens` bas en sortie.
- **Filtre de sortie** adapté à un public de 16 ans et plus, et recentrage sur l'univers du jeu.
- **Logs minimaux** : compteurs et erreurs, jamais le contenu des messages.
- **CORS** limité au domaine du jeu.

## Fournisseurs

À vérifier avant ouverture au public : pour chaque fournisseur activé dans FreeLLMAPI, que ses conditions autorisent un usage par des tiers, et ce qu'il fait des données (certains quotas gratuits servent à l'entraînement). La page de confidentialité du jeu le dit clairement. OpenRouter : modèles `:free`, 1 000 requêtes par jour après un achat de 10 $ de crédits.

## Déploiement

Docker Compose sur le VPS : `breach-gateway` (petit service Node ou Hono) et `freellmapi` sur un réseau interne, derrière un reverse proxy HTTPS. À construire au lot 4.
