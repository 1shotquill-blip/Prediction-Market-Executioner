/**
 * POLY-SHORE preflight — runs before every deployment / live start.
 * Exits non-zero on any failure; all checks are real network calls.
 *
 * Usage:  pnpm preflight
 */

import "dotenv/config";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

const results: CheckResult[] = [];
let anyFailed = false;

async function check(
  name: string,
  fn: () => Promise<string>
): Promise<void> {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, durationMs: Date.now() - t0 });
  } catch (err) {
    anyFailed = true;
    results.push({
      name,
      ok: false,
      detail: String(err instanceof Error ? err.message : err).slice(0, 300),
      durationMs: Date.now() - t0,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`${key} is not set`);
  return val;
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
  return res;
}

// ─── Checks ─────────────────────────────────────────────────────────────────

// 1. Required ENV vars present
await check("ENV: required vars present", async () => {
  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "POLYMARKET_PRIVATE_KEY",
    "POLYMARKET_FUNDER_ADDRESS",
    "POLYMARKET_API_KEY",
    "POLYMARKET_API_SECRET",
    "POLYMARKET_API_PASSPHRASE",
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  return `${required.length} vars present`;
});

// 2. Killswitches armed
await check("ENV: Polymarket killswitch ARMED", async () => {
  const armed =
    process.env.KILLSWITCH_ARMED === "true" ||
    process.env.POLYMARKET_KILLSWITCH_ARMED === "true";
  if (!armed) throw new Error("KILLSWITCH_ARMED / POLYMARKET_KILLSWITCH_ARMED must be 'true'");
  return "armed";
});

await check("ENV: Kalshi killswitch ARMED", async () => {
  if (process.env.KALSHI_KILLSWITCH_ARMED !== "true") {
    throw new Error("KALSHI_KILLSWITCH_ARMED must be 'true'");
  }
  return "armed";
});

// 3. Polymarket Gamma API reachable
await check("Polymarket: Gamma API reachable", async () => {
  const res = await httpGet("https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=1");
  const body = (await res.json()) as unknown[];
  if (!Array.isArray(body) || body.length === 0) throw new Error("Empty market list");
  return `${body.length} market(s) returned`;
});

// 4. Polymarket CLOB API reachable
await check("Polymarket: CLOB API reachable", async () => {
  const res = await httpGet("https://clob.polymarket.com/");
  const body = (await res.json()) as Record<string, unknown>;
  return `CLOB online — ${JSON.stringify(body).slice(0, 80)}`;
});

// 5. Polymarket CLOB authenticated (L1 credentials)
await check("Polymarket: CLOB auth (L1 key)", async () => {
  const apiKey = requireEnv("POLYMARKET_API_KEY");
  const secret = requireEnv("POLYMARKET_API_SECRET");
  const passphrase = requireEnv("POLYMARKET_API_PASSPHRASE");

  // The CLOB /auth/api-key endpoint validates credentials
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = await (async () => {
    const { createHmac } = await import("node:crypto");
    const msg = ts + "GET" + "/auth/api-key";
    return createHmac("sha256", secret).update(msg).digest("base64");
  })();

  const res = await fetch("https://clob.polymarket.com/auth/api-key", {
    headers: {
      "POLY_ADDRESS": requireEnv("POLYMARKET_FUNDER_ADDRESS"),
      "POLY_SIGNATURE": signature,
      "POLY_TIMESTAMP": ts,
      "POLY_API_KEY": apiKey,
      "POLY_PASSPHRASE": passphrase,
    },
  });
  if (!res.ok) throw new Error(`Auth check failed: ${res.status} ${res.statusText}`);
  return "L1 credentials accepted";
});

// 6. Kalshi API reachable + auth
await check("Kalshi: API auth", async () => {
  const email = process.env.KALSHI_EMAIL;
  const password = process.env.KALSHI_PASSWORD;
  if (!email || !password) throw new Error("KALSHI_EMAIL / KALSHI_PASSWORD not set — Kalshi will run paper-only");

  const res = await fetch("https://trading-api.kalshi.com/trade-api/v2/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Kalshi login failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as Record<string, unknown>;
  const token = String(body.token ?? body.access_token ?? "");
  if (!token) throw new Error("Kalshi returned no token");
  return "authenticated OK";
});

// 7. Kalshi balance readable
await check("Kalshi: cash balance readable", async () => {
  const email = process.env.KALSHI_EMAIL;
  const password = process.env.KALSHI_PASSWORD;
  if (!email || !password) throw new Error("Kalshi creds missing — skipping balance check");

  // Re-auth to get token
  const loginRes = await fetch("https://trading-api.kalshi.com/trade-api/v2/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = (await loginRes.json()) as Record<string, unknown>;
  const token = String(loginBody.token ?? loginBody.access_token ?? "");

  const balRes = await fetch("https://trading-api.kalshi.com/trade-api/v2/portfolio/balance", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!balRes.ok) throw new Error(`Balance fetch failed: ${balRes.status}`);
  const balBody = (await balRes.json()) as Record<string, unknown>;
  const cents = Number(balBody.balance ?? 0);
  return `$${(cents / 100).toFixed(2)} USD`;
});

// Helper: call Ollama /api/chat and return content string
async function ollamaPing(host: string, key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${host.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 200);
    throw new Error(`Ollama ${res.status} ${res.statusText}: ${txt}`);
  }
  const body = (await res.json()) as { message?: { content?: string }; model?: string };
  const content = body.message?.content ?? "";
  if (!content) throw new Error("Ollama returned empty content");
  return `model=${body.model ?? model} content_len=${content.length}`;
}

// 8a. Ollama Cloud: extractor model (stage 1 — factor extraction)
await check("LLM Ollama: extractor model (stage 1)", async () => {
  const key = process.env.OLLAMA_API_KEY;
  const host = process.env.OLLAMA_HOST ?? "https://ollama.com";
  const model = process.env.LLM_EXTRACTOR_MODEL ?? "qwen3.5:27b";
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  return await ollamaPing(
    host, key, model,
    'Return JSON: {"factors":["example factor"],"searchQueries":["example query"]}. Market: "Will the Fed cut rates in 2025?"'
  );
});

// 8b. Ollama Cloud: primary model (stage 2 — probability estimation)
await check("LLM Ollama: primary model (stage 2)", async () => {
  const key = process.env.OLLAMA_API_KEY;
  const host = process.env.OLLAMA_HOST ?? "https://ollama.com";
  const model = process.env.LLM_PRIMARY_MODEL ?? "deepseek-v4-pro";
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  return await ollamaPing(
    host, key, model,
    'Return JSON: {"outcome":"yes","probability":0.55,"confidence":0.6,"rationale":"test"}. Market: "Will the Fed cut rates in 2025?"'
  );
});

// 8c. Ollama Cloud: reasoner model (deep edge gate)
await check("LLM Ollama: reasoner model (deep gate)", async () => {
  const key = process.env.OLLAMA_API_KEY;
  const host = process.env.OLLAMA_HOST ?? "https://ollama.com";
  const model = process.env.LLM_REASONER_MODEL ?? "glm-5";
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  return await ollamaPing(
    host, key, model,
    'Return JSON: {"contrarianHypothesis":"test","steelmanCurrentPrice":"test","steelmanRebuttal":"test","identifiedBlindSpot":"test","fairPriceLow":0.4,"fairPriceHigh":0.6,"confidence":0.5,"expectedCorrectionPct":5,"catalyst":{"description":"test","expectedAt":"2025-12-31","expectedMovePct":3}}'
  );
});

// 8d. Fallback: Grok reachable (used when Ollama is down)
await check("LLM fallback: Grok reachable", async () => {
  const key = process.env.GROK_API_KEY;
  if (!key) throw new Error("GROK_API_KEY not set — Grok fallback disabled");
  const model = process.env.GROK_MODEL ?? "grok-3";
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 5 }),
  });
  if (!res.ok) {
    const txt = (await res.text()).slice(0, 200);
    throw new Error(`Grok ${res.status}: ${txt}`);
  }
  const body = (await res.json()) as { model?: string };
  return `model=${body.model ?? model} — OK`;
});

// 9. X / Twitter API reachable
await check("X: API reachable", async () => {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) throw new Error("X_BEARER_TOKEN not set — social signals disabled");
  const res = await fetch(
    "https://api.twitter.com/2/tweets/search/recent?query=polymarket&max_results=10",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`X API ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: unknown[] };
  return `${body.data?.length ?? 0} tweet(s) returned`;
});

// 10. Database connectivity
await check("Database: connection", async () => {
  const dbUrl = requireEnv("DATABASE_URL");
  // Dynamic import to avoid loading drizzle unless DB URL is present
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { sql } = await import("drizzle-orm");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });
  const db = drizzle(pool);
  const rows = await db.execute(sql`SELECT 1 AS ping`);
  await pool.end();
  if (!rows) throw new Error("No response from DB");
  return "SELECT 1 OK";
});

// ─── Report ──────────────────────────────────────────────────────────────────

const W = 66;
const bar = "═".repeat(W - 2);
console.log(`\n╔${bar}╗`);
console.log(`║  POLY-SHORE PREFLIGHT REPORT${" ".repeat(W - 31)}║`);
console.log(`╠${bar}╣`);

for (const r of results) {
  const icon = r.ok ? "✓" : "✗";
  const status = r.ok ? "PASS" : "FAIL";
  const name = r.name.padEnd(42).slice(0, 42);
  const ms = `${r.durationMs}ms`.padStart(6);
  console.log(`║  ${icon} ${status}  ${name}  ${ms}  ║`);
  if (!r.ok || r.detail) {
    const detail = r.detail.slice(0, W - 8);
    console.log(`║       ${detail.padEnd(W - 8)}║`);
  }
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`╠${bar}╣`);
console.log(`║  ${passed} passed  ${failed} failed${" ".repeat(W - 20 - String(passed).length - String(failed).length)}║`);
console.log(`╚${bar}╝\n`);

if (anyFailed) {
  console.error("Preflight FAILED — do not start bot in live mode until all checks pass.\n");
  process.exit(1);
} else {
  console.log("Preflight PASSED — system is live-money ready.\n");
  process.exit(0);
}
