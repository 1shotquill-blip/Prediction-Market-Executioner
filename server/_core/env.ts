// Fields that operator-router may update at runtime via process.env mutation are
// defined as getters so the running process always sees the current value.
export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
  ollamaApiKey: process.env.OLLAMA_API_KEY ?? "",
  llmPrimaryModel: process.env.LLM_PRIMARY_MODEL ?? "deepseek-v4-pro",
  llmReasonerModel: process.env.LLM_REASONER_MODEL ?? "glm-5",
  llmExtractorModel: process.env.LLM_EXTRACTOR_MODEL ?? "qwen3.5:27b",
  llmEnsembleModel: process.env.LLM_ENSEMBLE_MODEL ?? "qwen3.5:122b",
  llmFallbackProviders: process.env.LLM_FALLBACK_PROVIDERS ?? "openrouter,grok",
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  xBearerToken: process.env.X_BEARER_TOKEN ?? "",
  newsApiKey: process.env.NEWS_API_KEY ?? "",
  newsLookbackHours: Number(process.env.NEWS_LOOKBACK_HOURS ?? "24"),
  // Legacy email/password kept for migration compat — not used by RSA-PSS auth
  kalshiEmail: process.env.KALSHI_EMAIL ?? "",
  kalshiPassword: process.env.KALSHI_PASSWORD ?? "",
  // RSA-PSS API key auth
  kalshiApiBase:
    process.env.KALSHI_API_BASE_URL ??
    "https://external-api.kalshi.com/trade-api/v2",
  kalshiApiKeyId: process.env.KALSHI_API_KEY_ID ?? "",
  kalshiPrivateKeyPem: process.env.KALSHI_PRIVATE_KEY_PEM ?? "",
  kalshiPrivateKeyPath: process.env.KALSHI_PRIVATE_KEY_PATH ?? "",
  kalshiExecutionMode: (process.env.KALSHI_EXECUTION_MODE ?? "paper") as
    | "paper"
    | "live",
  kalshiKillswitchArmed: process.env.KALSHI_KILLSWITCH_ARMED === "true",
  kalshiMaxPositionUsd: Number(process.env.KALSHI_MAX_POSITION_USD ?? "2"),
  kalshiAbsoluteMaxPositionUsd: Number(
    process.env.KALSHI_ABSOLUTE_MAX_POSITION_USD ?? "3"
  ),
  kalshiMaxTotalExposureUsd: Number(
    process.env.KALSHI_MAX_TOTAL_EXPOSURE_USD ?? "8"
  ),
  kalshiMaxDailyLossUsd: Number(process.env.KALSHI_MAX_DAILY_LOSS_USD ?? "3"),
  kalshiMinBankrollReserveUsd: Number(
    process.env.KALSHI_MIN_BANKROLL_RESERVE_USD ?? "10"
  ),
  kalshiOrderTtlMs: Number(process.env.KALSHI_ORDER_TTL_MS ?? "15000"),
  kalshiPostOnly: process.env.KALSHI_POST_ONLY !== "false",
  kalshiAllowedMaxDaysToResolution: Number(
    process.env.KALSHI_ALLOWED_MAX_DAYS_TO_RESOLUTION ?? "2"
  ),
  kalshiPreferredHoursMin: Number(
    process.env.KALSHI_PREFERRED_HOURS_TO_RESOLUTION_MIN ?? "6"
  ),
  kalshiPreferredHoursMax: Number(
    process.env.KALSHI_PREFERRED_HOURS_TO_RESOLUTION_MAX ?? "48"
  ),
  deepEdgeMinScore: Number(process.env.DEEP_EDGE_MIN_SCORE ?? "0.7"),
  deepEdgeMinConfidence: Number(process.env.DEEP_EDGE_MIN_CONFIDENCE ?? "0.8"),
  maxBasketLegs: Number(process.env.MAX_BASKET_LEGS ?? "10"),
  catalystTimeoutMultiplier: Number(
    process.env.CATALYST_TIMEOUT_MULTIPLIER ?? "1.5"
  ),
  polymarketClobHost:
    process.env.POLYMARKET_HOST ??
    process.env.POLYMARKET_CLOB_HOST ??
    "https://clob.polymarket.com",
  polymarketChainId: Number(process.env.POLYMARKET_CHAIN_ID ?? "137"),
  polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY ?? "",
  polymarketFunderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? "",
  polymarketSignatureType: Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "0"),
  polymarketApiKey: process.env.POLYMARKET_API_KEY ?? "",
  polymarketApiSecret: process.env.POLYMARKET_API_SECRET ?? "",
  polymarketApiPassphrase: process.env.POLYMARKET_API_PASSPHRASE ?? "",
  polygonRpcUrl: process.env.POLYGON_RPC_URL ?? "",
  polymarketCredentialCachePath:
    process.env.POLYMARKET_CREDENTIAL_CACHE_PATH ??
    ".polymarket-l2-credentials.enc",
  polymarketCredentialCacheKey:
    process.env.POLYMARKET_CREDENTIAL_CACHE_KEY ?? "",
  polymarketWsUrl: process.env.POLYMARKET_WS_URL ?? "",
  polymarketDefaultTickSize: process.env.POLYMARKET_DEFAULT_TICK_SIZE ?? "0.01",
  polymarketKillswitchArmed:
    process.env.KILLSWITCH_ARMED === "true" ||
    process.env.POLYMARKET_KILLSWITCH_ARMED === "true",
  polymarketMaxNotionalUsd: Number(
    process.env.KILLSWITCH_NOTIONAL_CAP_USD ??
      process.env.POLYMARKET_MAX_NOTIONAL_USD ??
      "100"
  ),
  polymarketMaxOrdersPerMinute: Number(
    process.env.KILLSWITCH_ORDERS_PER_MIN ??
      process.env.POLYMARKET_MAX_ORDERS_PER_MINUTE ??
      "6"
  ),
  polymarketPerMarketCapUsd: Number(
    process.env.KILLSWITCH_PER_MARKET_CAP_USD ??
      process.env.POLYMARKET_PER_MARKET_CAP_USD ??
      "100"
  ),
  polymarketMaxSpreadBps: Number(
    process.env.KILLSWITCH_MAX_SPREAD_BPS ??
      process.env.POLYMARKET_MAX_SPREAD_BPS ??
      "500"
  ),
  arbsXyzApiKey: process.env.ARBS_XYZ_API_KEY ?? "",
  arbsXyzBaseUrl: process.env.ARBS_XYZ_BASE_URL ?? "https://arbs.xyz",
  grokApiKey: process.env.GROK_API_KEY ?? "",
  grokModel: process.env.GROK_MODEL ?? "grok-3",
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  groqModel: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
  llmProviderStrategy: (process.env.LLM_PROVIDER_STRATEGY ?? "local-only") as
    | "local-only"
    | "cloud-only"
    | "hybrid",
  // ─── Runtime tuning (spec §3.2) — getters so operator-router mutations apply ─
  get orderTtlMs() {
    return Number(process.env.ORDER_TTL_MS ?? "300000");
  },
  get pollIntervalMs() {
    return Number(process.env.POLL_INTERVAL_MS ?? "15000");
  },
  get maxPositionUsd() {
    return Number(process.env.MAX_POSITION_USD ?? "100");
  },
  get maxDrawdownPct() {
    return Number(process.env.MAX_DRAWDOWN_PCT ?? "0.15") * 100;
  },
};

export function validateProductionEnv(): void {
  if (!ENV.isProduction) return;

  const missing: string[] = [];

  // Core Infra
  if (!ENV.databaseUrl) missing.push("DATABASE_URL");
  if (!ENV.cookieSecret) missing.push("JWT_SECRET");

  // LLM Requirements
  if (ENV.llmProviderStrategy !== "local-only") {
    if (!ENV.openaiApiKey && !ENV.anthropicApiKey && !ENV.groqApiKey) {
      missing.push(
        "At least one cloud LLM API Key (OPENAI, ANTHROPIC, or GROQ)"
      );
    }
  }

  // Exchange Config
  const hasKalshi = !!(
    ENV.kalshiApiKeyId &&
    (ENV.kalshiPrivateKeyPem || ENV.kalshiPrivateKeyPath)
  );
  const hasPoly = !!(ENV.polymarketPrivateKey && ENV.polymarketFunderAddress);

  if (!hasKalshi && !hasPoly) {
    missing.push("At least one exchange (Kalshi or Polymarket credentials)");
  }

  if (missing.length > 0) {
    console.error(`[ENV] Deployment blocked: missing ${missing.join(", ")}`);
    process.exit(1);
  }
}
