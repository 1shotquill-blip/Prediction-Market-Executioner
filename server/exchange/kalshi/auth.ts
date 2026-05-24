import { createSign, constants } from "node:crypto";
import { readFileSync } from "node:fs";
import { ENV } from "../../_core/env";

// ─── Error types ─────────────────────────────────────────────────────────────

export class KalshiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KalshiConfigurationError";
  }
}

// ─── RSA-PSS signing ─────────────────────────────────────────────────────────

/**
 * Returns the PEM private key from env vars:
 *  1. KALSHI_PRIVATE_KEY_PEM (inline PEM string)
 *  2. KALSHI_PRIVATE_KEY_PATH (path to PEM file)
 *
 * Returns null if neither is set (paper mode).
 */
function loadPrivateKeyPem(): string | null {
  if (ENV.kalshiPrivateKeyPem) return ENV.kalshiPrivateKeyPem;
  if (ENV.kalshiPrivateKeyPath) {
    try {
      return readFileSync(ENV.kalshiPrivateKeyPath, "utf-8");
    } catch {
      throw new KalshiConfigurationError(
        `Cannot read KALSHI_PRIVATE_KEY_PATH: ${ENV.kalshiPrivateKeyPath}`
      );
    }
  }
  return null;
}

export interface KalshiAuthHeaders {
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
  "KALSHI-ACCESS-SIGNATURE": string;
}

/**
 * Produces Kalshi RSA-PSS auth headers.
 * @param method  HTTP method, e.g. "GET"
 * @param path    Full path including query string, e.g. /trade-api/v2/portfolio/balance?foo=bar
 */
export function buildKalshiAuthHeaders(
  method: string,
  path: string
): KalshiAuthHeaders {
  const apiKeyId = ENV.kalshiApiKeyId;
  const privateKeyPem = loadPrivateKeyPem();

  if (!apiKeyId || !privateKeyPem) {
    throw new KalshiConfigurationError(
      "KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PEM (or KALSHI_PRIVATE_KEY_PATH) are required for Kalshi live auth"
    );
  }

  // Kalshi requires timestamp as Unix milliseconds string, not ISO
  const timestamp = Date.now().toString();
  // Strip query string before signing
  const pathWithoutQuery = path.split("?")[0];
  const payload = timestamp + method.toUpperCase() + pathWithoutQuery;

  const sign = createSign("SHA256");
  sign.update(payload);
  sign.end();
  const signature = sign.sign(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    },
    "base64"
  );

  return {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signature,
  };
}

/**
 * Returns true if live-mode credentials are configured.
 */
export function hasKalshiCredentials(): boolean {
  return !!(
    ENV.kalshiApiKeyId &&
    (ENV.kalshiPrivateKeyPem || ENV.kalshiPrivateKeyPath)
  );
}

// ─── Legacy compat stubs (kept so existing imports don't break) ───────────────

/** @deprecated Use buildKalshiAuthHeaders instead */
export interface KalshiAuthConfig {
  email?: string;
  password?: string;
  baseUrl?: string;
}

/** @deprecated No longer used; RSA-PSS signing replaces token auth */
export interface KalshiTokenState {
  token: string;
  expiresAt?: Date;
}

/** @deprecated No longer used; auth is stateless RSA-PSS per-request */
export class KalshiAuthManager {
  constructor(_config: KalshiAuthConfig = {}) {}
  async getToken(_forceRefresh = false): Promise<string> {
    throw new KalshiConfigurationError(
      "KalshiAuthManager.getToken() is deprecated. Use buildKalshiAuthHeaders() for RSA-PSS auth."
    );
  }
  clear(): void {}
}
