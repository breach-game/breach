/**
 * Signed catalogues. Community packs are served from a catalogue the game does not build itself, so
 * the catalogue file is signed when it is published, and the game checks the signature with a
 * public key compiled into its code before it reads a single entry. Each entry then pins the exact
 * bytes of its pack (SHA-256), so one signature covers every pack of the catalogue.
 *
 * ECDSA P-256 with SHA-256: available in every browser's Web Crypto and in Node.js, no dependency.
 * The signature is the raw 64-byte form (r then s, IEEE P1363), in base64; the key is SPKI, in base64.
 */

/** Id prefix reserved for the packs the game ships with. A community catalogue may not use it. */
export const OFFICIAL_PREFIX = 'breach.';

export const isOfficialId = (id: string) => id.startsWith(OFFICIAL_PREFIX);

export const SIGNATURE_ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Does `signature` (base64) sign exactly `bytes` with the key `publicKey` (SPKI, base64)?
 * Any malformed input counts as a bad signature.
 */
export async function verifySignature(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', fromBase64(publicKey), SIGNATURE_ALGORITHM, false, [
      'verify',
    ]);
    const sig = fromBase64(signature);
    if (sig.length !== 64) return false;
    return await crypto.subtle.verify(SIGNATURE_ALGORITHM, key, sig, bytes);
  } catch {
    return false;
  }
}
