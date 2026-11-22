# Security

BREACH is a static website. It has no game server, no accounts and no database, and everything it simulates stays inside the player's browser tab. This page sums up what protects the player and the content, and how to report a problem.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting: **Security > Report a vulnerability** on this repository. Do not open a public issue for a security problem.

## What the game guarantees

**No real network activity from gameplay.** The engine (`packages/engine`) has no network API and no dependency besides the pack schema. Commands and the in-game browser only read the fictional world held in memory. The page itself makes four kinds of request: its own files, the mission packs from the same origin, the community catalogue when the player opens *Community missions*, and `api.anthropic.com` when the player sets their own key.

**Content cannot carry code or real targets.** A pack is data, checked against a strict schema (`packages/pack-schema`):

- every domain must be reserved (`.test`, `.example`, `.invalid`, `.localhost`, `example.com`…), every address private or reserved for documentation, and a scope network may not be wider than its reserved block;
- script-like text and control characters, terminal escape sequences included, are refused;
- size is capped before and after decompression.

**Official packs are pinned.** The build compiles the SHA-256 of each official pack into the game's code. The game refuses an official pack whose bytes differ, and refuses a campaign that lists a pack this build does not know, even if the catalogue next to it was changed.

**Community packs are signed and checked like the others.** Missions written by players come from the `breach-game/packs` repository, published on GitHub Pages after review. Its `index.json` is signed (ECDSA P-256) by the publishing workflow, and the game checks that signature with a public key compiled into its code before reading any entry, also when the catalogue comes from the cache. Each entry pins its pack's SHA-256, then the pack goes through the same schema and safety checks as an official one. A community catalogue cannot list an id starting with `breach.`, cannot form a campaign, and a copy older than the last one seen is ignored, so a withdrawn pack cannot come back. Each community mission is saved apart from the campaign. The private key is a secret of the `packs` repository and never appears in a repository.

**Nothing is rendered as HTML.** Pages, messages and character replies are drawn with React as text. Terminal output keeps colour codes only: every other escape sequence is removed, and the terminal never opens a link.

**Strict browser policy.** The production build sets a Content Security Policy with no third-party origin, no inline script, and Trusted Types required. Hosts that read `_headers` (Cloudflare Pages) also get `frame-ancestors 'none'`, `nosniff` and a closed permissions policy. The game refuses to start inside another site's frame.

## Bring your own key

The optional model help uses the player's own Anthropic API key. The player switches on each use separately, picks its model, and sees an estimate of what it costs per message and per campaign, plus what this tab has spent so far:

- **Understand my messages**: a model reads the player's message and names which of the character's word groups and which technique families it means, even when worded freely. Its answer is constrained to JSON and checked by the engine (`acceptHearing`): only groups from the character's vocabulary and families from the engine's fixed list are kept. So a model, even one the player manipulates through prompt injection, can only add what the player could have typed. Intents marked `literal` (names and code words found during the mission) never take a model's word for it, and their words are never sent to the model. The scripted brain then decides as usual.
- **Reword the replies**: the model only rewords a line the script has already chosen; it never sees a secret before the script gives it away, and the engine rejects any wording that adds, drops or invents a flag.

For both uses:

- the key is kept in session storage (or local storage if the player asks), never in the save, and is sent only to `api.anthropic.com`;
- the model has no tools and its text is only ever shown as text; on any error, refusal, failed check or delay, the script works alone and the player is never blocked;
- what the model understood is recorded in the save, so a resumed game replays without calling it;
- each use is capped at 150 calls per tab, so a stuck key cannot run up a bill. The settings screen recommends a key made for the game, with a spending limit.

Pack text that reaches the model (a character's vocabulary and style sheet, a scripted line) is schema-checked like any pack content. A hostile community pack could at worst steer what a model hears or says, which the checks above bound to what the pack's own script already allows.

## Known limits

- Flags can be read in the pack files and in some hints. The score is for the player alone; it is not a competition and there is no leaderboard.
- On GitHub Pages, headers cannot be set: the policy comes from the page's meta tag, which cannot express `frame-ancestors`. Cloudflare Pages is the recommended host.
- Without a custom domain, every GitHub Pages site of the `breach-game` organisation shares the origin `breach-game.github.io`, so the game shares its storage with them. The `packs` site publishes data files only (no HTML, no script); keep it that way, or move the game to its own domain.
- The development server (`pnpm dev`) accepts an unsigned local catalogue set with `VITE_COMMUNITY_CATALOG`, so authors can try their packs. A production build always requires the signature.
- The LLM gateway (after v1) will get its own review.
