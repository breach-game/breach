/**
 * Where the community missions come from, and the key their catalogue must be signed with.
 *
 * The catalogue is published by the `breach-game/packs` repository after each merged, reviewed pull
 * request. Its `index.json` is signed by the publishing workflow; the game refuses any catalogue
 * whose signature does not match this public key, then checks every pack against the SHA-256 in
 * that catalogue. Changing the key means rebuilding the game.
 *
 * `VITE_COMMUNITY_CATALOG` overrides the address. With `pnpm dev` only, a catalogue set that way may
 * be unsigned, so that authors can try their packs in the game (see the guide in `breach-game/packs`).
 * A production build always requires the signature.
 */
export const DEFAULT_COMMUNITY_CATALOG = 'https://breach-game.github.io/packs/';

// `import.meta.env` is undefined when vite.config.ts reads this file to build the CSP.
export const COMMUNITY_CATALOG_URL: string =
  import.meta.env?.VITE_COMMUNITY_CATALOG || DEFAULT_COMMUNITY_CATALOG;

/** ECDSA P-256 public key (SPKI, base64) of the community catalogue. */
export const COMMUNITY_PUBLIC_KEY =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEa+xv3ttVDxLoIjU6frfE/e8NQBP66GwqbxdCOFxM0QHF9emJGcf32vNb148hH2XJNNDO15TCer8tagYbB2dGwA==';

/** Development server with a local catalogue: the signature is not required. Always false in a build. */
export const UNSIGNED_COMMUNITY_CATALOG: boolean =
  !!import.meta.env?.DEV && !!import.meta.env?.VITE_COMMUNITY_CATALOG;
