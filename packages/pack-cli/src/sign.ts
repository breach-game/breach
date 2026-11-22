/**
 * Keys and signatures for the community catalogue (see `verifySignature` in the pack schema).
 * The private key never lives in a repository: it is a secret of the publishing workflow.
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

export interface KeyPair {
  /** SPKI, base64: compiled into the game. */
  publicKey: string;
  /** PKCS #8, PEM: kept as a secret by whoever publishes the catalogue. */
  privateKey: string;
}

export function generateKeys(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/** Sign the exact bytes of a catalogue. Returns the raw signature (r then s), in base64. */
export function signBytes(bytes: Uint8Array, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('the signing key must be an ECDSA P-256 private key');
  return sign('sha256', bytes, { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
}
