# BREACH LLM gateway

Optional service that gives players free-form dialogue with NPCs, free of charge and with a quota. It runs on the VPS, never on the home server.

## How it works

```
browser ──► BREACH API (VPS) ──► FreeLLMAPI (VPS, private network) ──► free providers
```

- FreeLLMAPI is never exposed to the Internet: it only listens on the internal Docker network. The project is designed for a single user.
- The BREACH API is the only public entry point.

## Contract

`POST /v1/npc/reply`

```json
{ "npcId": "nova", "locale": "fr", "history": [...], "message": "..." }
```

- The client never sends a system prompt. The server loads the NPC sheet (`npcs/<npcId>.yaml`) and builds the prompt itself, so the gateway cannot be used as a general-purpose chatbot.
- Response: `{ "text": "...", "remaining": 37 }`. Quota exhausted: HTTP 429, and the game falls back to scripted mode.

## Protections

- **Anonymous token** per browser, issued by `POST /v1/session` after an invisible Cloudflare Turnstile captcha. No account, no personal data.
- **Quotas**: messages per token per day (40 to start with), a per-IP limit, a global daily cap.
- **Limits**: incoming message length, truncated history, low output `max_tokens`.
- **Output filter** suited to a 16+ audience, and steering back to the game's universe.
- **Minimal logs**: counters and errors, never message content.
- **CORS** restricted to the game's domain.

## Providers

To check before opening to the public: for each provider enabled in FreeLLMAPI, that its terms allow third-party use, and what it does with the data (some free tiers are used for training). The game's privacy page says so clearly. OpenRouter: `:free` models, 1,000 requests per day after buying $10 of credits.

## Deployment

Docker Compose on the VPS: `breach-gateway` (small Node or Hono service) and `freellmapi` on an internal network, behind an HTTPS reverse proxy. To be built in lot 4.
