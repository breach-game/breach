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

The optional character voices use the player's own Anthropic API key:

- the key is kept in session storage (or local storage if the player asks), never in the save, and is sent only to `api.anthropic.com`;
- the model only rewords a line the script has already chosen; it never sees a secret before the script gives it away, and the engine rejects any wording that adds, drops or invents a flag;
- one tab asks for at most 150 model replies, so a stuck key cannot run up a bill. The settings screen recommends a key made for the game, with a spending limit.

## Known limits

- Flags can be read in the pack files and in some hints. The score is for the player alone; it is not a competition and there is no leaderboard.
- On GitHub Pages, headers cannot be set: the policy comes from the page's meta tag, which cannot express `frame-ancestors`. Cloudflare Pages is the recommended host.
- Without a custom domain, every GitHub Pages site of the `breach-game` organisation shares the origin `breach-game.github.io`, so the game shares its storage with them. The `packs` site publishes data files only (no HTML, no script); keep it that way, or move the game to its own domain.
- The development server (`pnpm dev`) accepts an unsigned local catalogue set with `VITE_COMMUNITY_CATALOG`, so authors can try their packs. A production build always requires the signature.
- The LLM gateway (after v1) will get its own review.
