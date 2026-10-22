import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import bs58 from 'bs58';
import {
  ensureOrbitflareDir,
  KEYPAIR_FILE,
  MissingKeypairError,
  setWalletAddress,
} from '../config.js';

let activeSigner: KeyPairSigner | null = null;

export function getActiveSigner(): KeyPairSigner | null {
  return activeSigner;
}

export function requireSigner(): KeyPairSigner {
  if (!activeSigner) throw new MissingKeypairError();
  return activeSigner;
}

export async function generateKeypair(persist = true): Promise<KeyPairSigner> {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  activeSigner = signer;
  setWalletAddress(signer.address);
  if (persist) writeKeypairFile(seed);
  return signer;
}

export async function loadKeypairFromBytes(bytes: Uint8Array): Promise<KeyPairSigner> {
  let signer: KeyPairSigner;
  if (bytes.length === 32) {
    signer = await createKeyPairSignerFromPrivateKeyBytes(bytes, true);
  } else if (bytes.length === 64) {
    signer = await createKeyPairSignerFromBytes(bytes);
  } else {
    throw new Error(
      `Keypair bytes must be 32 (private key) or 64 (Solana CLI format), got ${bytes.length}.`,
    );
  }
  activeSigner = signer;
  setWalletAddress(signer.address);
  return signer;
}

export async function loadKeypairFromBase58Secret(
  secret: string,
): Promise<KeyPairSigner> {
  const bytes = bs58.decode(secret);
  return loadKeypairFromBytes(bytes);
}

export async function loadKeypairFromFile(path: string): Promise<KeyPairSigner> {
  const raw = readFileSync(path, 'utf8').trim();
  let bytes: Uint8Array;
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw) as number[];
    bytes = new Uint8Array(arr);
  } else if (/^[0-9a-fA-F]+$/.test(raw)) {
    bytes = new Uint8Array(Buffer.from(raw, 'hex'));
  } else {
    bytes = bs58.decode(raw);
  }
  return loadKeypairFromBytes(bytes);
}

export async function loadKeypairFromDisk(): Promise<KeyPairSigner | null> {
  if (!existsSync(KEYPAIR_FILE)) return null;
  try {
    return await loadKeypairFromFile(KEYPAIR_FILE);
  } catch {
    return null;
  }
}

function writeKeypairFile(seed: Uint8Array): void {
  ensureOrbitflareDir();
  writeFileSync(KEYPAIR_FILE, JSON.stringify(Array.from(seed)));
  try {
    chmodSync(KEYPAIR_FILE, 0o600);
  } catch {
    // best-effort
  }
}

export function clearKeypair(removeFromDisk = false): void {
  activeSigner = null;
  setWalletAddress(null);
  if (removeFromDisk && existsSync(KEYPAIR_FILE)) {
    try {
      unlinkSync(KEYPAIR_FILE);
    } catch {
      // best-effort
    }
  }
}

export async function signMessageBytes(message: Uint8Array): Promise<Uint8Array> {
  return signBytes(requireSigner().keyPair.privateKey, message);
}

export function signatureToBase58(sig: Uint8Array): string {
  return bs58.encode(sig);
}
