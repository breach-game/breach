# BREACH LLM gateway

Optional service, planned after v1, that will let players talk freely with characters without an API key of their own, within a daily quota. It is not built yet. The game works fully without it: scripted characters by default, or the player's own key (BYOK).

## Where it runs

A small API on **Cloudflare Workers** (decision of 22 November 2026, see `breach-game/docs`, `architecture/architecture.md`):

```
browser ──► BREACH gateway (Cloudflare Worker) ──► model provider(s)
                 │
                 └── Durable Object: quotas and counters
```

- No server to maintain, free to deploy, and a public surface kept apart from any personal machine.
- Turnstile (Cloudflare's invisible captcha) issues the anonymous token.
- A Durable Object keeps the quotas: per token, per IP, and a global daily cap.
- The provider keys are Worker secrets. They never reach the browser.

## Contract

The gateway implements the same two roles as the BYOK brain (`NpcBrain` in the repository's `CLAUDE.md`), so the engine treats it exactly like a player's key: the scripted brain always decides, the model only interprets messages (`hear`) or rewords the reply already chosen (`reply`).

`POST /v1/npc/hear` and `POST /v1/npc/reply`

```json
{ "pack": "breach.official.m03@1.0.0", "npcId": "nova", "locale": "fr", "history": [...], "message": "..." }
```

- The client never sends a prompt. The Worker only serves reviewed packs, which it knows by hash, and builds the prompt itself from the character sheet. It cannot be used as a general-purpose chatbot.
- Response: the same JSON as the BYOK brain, plus `remaining`. Quota exhausted: HTTP 429, and the game falls back to scripted mode without blocking the player.
- The engine still filters everything the model returns (`acceptHearing`, `acceptWording`).

## Protections

- **Anonymous token** per browser, issued by `POST /v1/session` after Turnstile. No account, no personal data.
- **Quotas**: 40 messages per token per day to start with, a per-IP limit, a global daily cap and a cost ceiling.
- **Limits**: incoming message length, truncated history, low output `max_tokens`.
- **Output filter** suited to a 16+ audience that does not depend on the model.
- **Minimal logs**: counters and errors, never message content (players may be minors).
- **CORS** restricted to the game's domain, which then joins `connect-src` in the game's CSP.

## Before opening it

- Check each provider's terms: serving third parties through a proxy, and services that minors may use.
- Write the privacy page (what is sent, what is kept, which providers).
- A dedicated security review, like the one done for the game.
