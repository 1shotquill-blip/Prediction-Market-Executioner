import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "../../_core/env";
import { PolymarketConfigurationError } from "./errors";
import type { PolymarketApiCredentials, PolymarketClientLike } from "./types";

interface CachedCredentialsEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface CredentialCacheOptions {
  cachePath?: string;
  cacheKey?: string;
}

export function readEnvL2Credentials(): PolymarketApiCredentials | null {
  if (
    !ENV.polymarketApiKey ||
    !ENV.polymarketApiSecret ||
    !ENV.polymarketApiPassphrase
  ) {
    return null;
  }

  return {
    key: ENV.polymarketApiKey,
    secret: ENV.polymarketApiSecret,
    passphrase: ENV.polymarketApiPassphrase,
  };
}

function deriveCacheKey(secret: string): Buffer {
  if (!secret) {
    throw new PolymarketConfigurationError(
      "POLYMARKET_CREDENTIAL_CACHE_KEY is required to encrypt cached L2 credentials"
    );
  }
  return createHash("sha256").update(secret).digest();
}

function encryptCredentials(
  credentials: PolymarketApiCredentials,
  secret: string
): CachedCredentialsEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveCacheKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptCredentials(
  envelope: CachedCredentialsEnvelope,
  secret: string
): PolymarketApiCredentials {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveCacheKey(secret),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as PolymarketApiCredentials;
}

export async function readCachedL2Credentials(
  cachePath = ENV.polymarketCredentialCachePath,
  secret = ENV.polymarketCredentialCacheKey
): Promise<PolymarketApiCredentials | null> {
  try {
    const envelope = JSON.parse(
      await readFile(cachePath, "utf8")
    ) as CachedCredentialsEnvelope;
    if (envelope.version !== 1) return null;
    return decryptCredentials(envelope, secret);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function writeCachedL2Credentials(
  credentials: PolymarketApiCredentials,
  cachePath = ENV.polymarketCredentialCachePath,
  secret = ENV.polymarketCredentialCacheKey
): Promise<void> {
  const dir = path.dirname(cachePath);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true, mode: 0o700 });
  const envelope = encryptCredentials(credentials, secret);
  await writeFile(cachePath, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function getOrDeriveL2Credentials(
  client: PolymarketClientLike,
  options: CredentialCacheOptions = {}
): Promise<PolymarketApiCredentials> {
  const envCredentials = readEnvL2Credentials();
  if (envCredentials) return envCredentials;

  const cached = await readCachedL2Credentials(
    options.cachePath,
    options.cacheKey
  );
  if (cached) return cached;

  if (!client.createOrDeriveApiKey) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose createOrDeriveApiKey"
    );
  }

  const credentials = await client.createOrDeriveApiKey();
  if (!credentials.key || !credentials.secret || !credentials.passphrase) {
    throw new PolymarketConfigurationError(
      "Derived Polymarket L2 credentials are incomplete"
    );
  }
  await writeCachedL2Credentials(
    credentials,
    options.cachePath,
    options.cacheKey
  );
  return credentials;
}
