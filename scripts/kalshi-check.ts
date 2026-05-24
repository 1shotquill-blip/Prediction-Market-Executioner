/**
 * scripts/kalshi-check.ts
 *
 * Checks Kalshi connectivity and prints safe status info.
 * Run: pnpm run kalshi:check
 *
 * NEVER prints: private key, API key ID, full headers, raw JSON.
 * NEVER places orders.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { createSign, constants } from "node:crypto";

const executionMode = process.env.KALSHI_EXECUTION_MODE ?? "paper";
const apiKeyId = process.env.KALSHI_API_KEY_ID ?? "";
const privateKeyPem = process.env.KALSHI_PRIVATE_KEY_PEM ?? "";
const privateKeyPath = process.env.KALSHI_PRIVATE_KEY_PATH ?? "";
const apiBase =
  process.env.KALSHI_API_BASE_URL ??
  "https://external-api.kalshi.com/trade-api/v2";
const killswitchArmed = process.env.KALSHI_KILLSWITCH_ARMED === "true";
const maxPositionUsd = process.env.KALSHI_MAX_POSITION_USD ?? "2";
const maxTotalExposureUsd = process.env.KALSHI_MAX_TOTAL_EXPOSURE_USD ?? "8";
const maxDaysToResolution =
  process.env.KALSHI_ALLOWED_MAX_DAYS_TO_RESOLUTION ?? "2";

function loadPem(): string | null {
  if (privateKeyPem) return privateKeyPem;
  if (privateKeyPath) {
    try {
      return readFileSync(privateKeyPath, "utf-8");
    } catch {
      return null;
    }
  }
  return null;
}

function buildAuthHeaders(
  method: string,
  path: string,
  pem: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const pathWithoutQuery = path.split("?")[0];
  const payload = timestamp + method.toUpperCase() + pathWithoutQuery;

  const sign = createSign("SHA256");
  sign.update(payload);
  sign.end();
  const signature = sign.sign(
    {
      key: pem,
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

async function main(): Promise<void> {
  const pem = loadPem();
  const isLive = executionMode === "live";
  const hasCredentials = !!(apiKeyId && pem);

  if (!isLive || !hasCredentials) {
    console.log("mode: paper — skipping live auth check");
    console.log(`execution_mode: ${executionMode}`);
    console.log(`killswitch_armed: ${killswitchArmed}`);
    console.log(`max_position_usd: ${maxPositionUsd}`);
    console.log(`max_total_exposure_usd: ${maxTotalExposureUsd}`);
    console.log(`max_days_to_resolution: ${maxDaysToResolution}`);
    process.exit(0);
  }

  // Live mode with credentials — test auth
  const path = "/trade-api/v2/portfolio/balance";
  let authOk = false;
  let balanceCents: number | null = null;
  let portfolioValueCents: number | null = null;

  try {
    const headers = buildAuthHeaders("GET", path, pem!);
    const response = await fetch(`${apiBase}/portfolio/balance`, {
      method: "GET",
      headers: {
        accept: "application/json",
        ...headers,
      },
    });

    if (response.ok) {
      authOk = true;
      const body = (await response.json()) as Record<string, unknown>;
      balanceCents = Number(
        (body as Record<string, unknown>).balance ??
          (body.portfolio as Record<string, unknown> | undefined)?.balance ??
          0
      );
      portfolioValueCents = balanceCents;
    }
  } catch {
    authOk = false;
  }

  console.log(`auth: ${authOk ? "ok" : "failed"}`);
  if (balanceCents !== null) console.log(`balance_cents: ${balanceCents}`);
  if (portfolioValueCents !== null)
    console.log(`portfolio_value_cents: ${portfolioValueCents}`);
  console.log(`execution_mode: ${executionMode}`);
  console.log(`killswitch_armed: ${killswitchArmed}`);
  console.log(`max_position_usd: ${maxPositionUsd}`);
  console.log(`max_total_exposure_usd: ${maxTotalExposureUsd}`);
  console.log(`max_days_to_resolution: ${maxDaysToResolution}`);

  process.exit(authOk ? 0 : 1);
}

main().catch(err => {
  console.error("kalshi:check error:", String(err));
  process.exit(1);
});
