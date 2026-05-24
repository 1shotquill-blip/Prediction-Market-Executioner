import { invokeLLM } from "../_core/llm";
import type { AgentMarket, TradeIntent } from "../agent/types";
import { fetchArbsXyzOpportunities } from "./arbs-feed";

export interface ArbitrageScanOptions {
  /** Maximum total cost (yes + no) to qualify as an opportunity. Default 0.98 */
  maxTotalCost?: number;
  /** Minimum liquidity (USD) for each leg. Default 0 */
  minLiquidityUsd?: number;
  /** Minimum 24h volume (USD) for each leg. Default 0 */
  minVolume24hUsd?: number;
  /** Maximum hours until market expiry. 0 = no limit */
  maxHoursToExpiry?: number;
}

export interface CrossExchangeArbitrageOpportunity {
  anomalyType: "cross_exchange_arbitrage";
  /** Where this opportunity was discovered */
  source: "internal" | "arbs_xyz";
  polymarket: AgentMarket;
  kalshi: AgentMarket;
  semanticMatchConfidence: number;
  polymarketYesPrice: number;
  kalshiNoPrice: number;
  gap: number;
  intents: [TradeIntent, TradeIntent];
}

interface SemanticMatch {
  polymarketId: string;
  kalshiId: string;
  confidence: number;
}

interface CacheEntry {
  matches: SemanticMatch[];
  expiresAt: number;
}

// 5-minute TTL so the LLM re-evaluates on each dashboard refresh cycle
const CACHE_TTL_MS = 5 * 60 * 1_000;
const semanticCache = new Map<string, CacheEntry>();

function cacheKey(polymarket: AgentMarket[], kalshi: AgentMarket[]): string {
  return [
    ...polymarket.map(m => m.marketId).sort(),
    "::",
    ...kalshi.map(m => m.marketId).sort(),
  ].join("|");
}

function parseLLMText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices[0]?.message.content;
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text"
    )
    .map(part => part.text)
    .join("");
}

/**
 * LLM-powered semantic market matcher.
 *
 * The prompt includes live price data so the model can factor in whether the
 * claimed spread is plausible (e.g. near-identical questions with wildly
 * different prices are a red flag for rule-set mismatches).
 *
 * Results are cached for CACHE_TTL_MS to avoid hammering the LLM on every
 * tick while still refreshing fast enough to catch new opportunities.
 */
async function matchMarketsSemantically(
  polymarket: AgentMarket[],
  kalshi: AgentMarket[]
): Promise<SemanticMatch[]> {
  if (polymarket.length === 0 || kalshi.length === 0) return [];

  const key = cacheKey(polymarket, kalshi);
  const cached = semanticCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: [
          "You are an expert prediction market analyst.",
          "Your task: identify pairs of markets from Polymarket and Kalshi that ask",
          "the SAME real-world binary question and will resolve identically.",
          "",
          "Rules:",
          "- Only match markets where the resolution criteria are equivalent.",
          "  Different expiry dates, different thresholds, or different rule sets",
          "  (e.g. one market excludes overtime) must NOT be matched.",
          "- Use the mid-price (avg of yes_ask and 1-yes_ask) as a sanity check:",
          "  if two markets claim to be equivalent but their implied probabilities",
          "  differ by more than 0.15, lower your confidence accordingly — it",
          "  likely indicates a rule-set difference.",
          "- Assign confidence 0.0–1.0. Only return pairs with confidence >= 0.75.",
          "- Return ONLY the JSON object, no prose.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          polymarket: polymarket.slice(0, 40).map(m => ({
            id: m.marketId,
            question: m.question,
            category: m.category,
            yes_ask: m.bestAsk,
            implied_prob: ((m.bestBid + m.bestAsk) / 2).toFixed(3),
            expires: m.expiresAt.toISOString().slice(0, 10),
          })),
          kalshi: kalshi.slice(0, 40).map(m => ({
            id: m.marketId,
            question: m.question,
            category: m.category,
            yes_ask: m.bestAsk,
            implied_prob: ((m.bestBid + m.bestAsk) / 2).toFixed(3),
            expires: m.expiresAt.toISOString().slice(0, 10),
          })),
        }),
      },
    ],
    outputSchema: {
      name: "cross_exchange_market_matches",
      schema: {
        type: "object",
        properties: {
          matches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                polymarketId: { type: "string" },
                kalshiId: { type: "string" },
                confidence: { type: "number" },
              },
              required: ["polymarketId", "kalshiId", "confidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["matches"],
        additionalProperties: false,
      },
      strict: true,
    },
  });

  const parsed = JSON.parse(parseLLMText(result)) as {
    matches?: SemanticMatch[];
  };
  const matches = (parsed.matches ?? []).filter(m => m.confidence >= 0.75);
  semanticCache.set(key, { matches, expiresAt: Date.now() + CACHE_TTL_MS });
  return matches;
}

/**
 * LLM validation pass for arbs.xyz opportunities.
 *
 * arbs.xyz gives us pre-matched pairs but we don't know whether their rule-set
 * equivalence check is correct. We send the question text + current prices to
 * the LLM and ask it to confirm or reject each pair, returning a confidence
 * score. Pairs below 0.75 confidence are dropped — we'd rather miss a trade
 * than execute a mis-matched arb.
 */
async function validateExternalOpportunities(
  opportunities: CrossExchangeArbitrageOpportunity[]
): Promise<CrossExchangeArbitrageOpportunity[]> {
  if (opportunities.length === 0) return [];

  let result: Awaited<ReturnType<typeof invokeLLM>>;
  try {
    result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: [
            "You are a prediction market compliance expert.",
            "Given pairs of Polymarket and Kalshi markets, assess whether they:",
            "  1. Ask the SAME binary question with identical resolution criteria.",
            "  2. Have plausible price spreads (mid-price difference < 0.20).",
            "  3. Are NOT affected by platform-specific rule differences",
            "     (e.g. overtime rules, different cutoff dates, different thresholds).",
            "Return confidence 0.0–1.0 per pair. Be strict — false positives cost money.",
            "Return ONLY the JSON object.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            opportunities.map(o => ({
              polymarketId: o.polymarket.marketId,
              kalshiId: o.kalshi.marketId,
              polymarketQuestion: o.polymarket.question,
              kalshiQuestion: o.kalshi.question,
              polymarketYesAsk: o.polymarketYesPrice,
              kalshiNoBid: o.kalshiNoPrice,
              spreadGap: o.gap.toFixed(4),
            }))
          ),
        },
      ],
      outputSchema: {
        name: "external_arb_validation",
        schema: {
          type: "object",
          properties: {
            validations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  polymarketId: { type: "string" },
                  kalshiId: { type: "string" },
                  confidence: { type: "number" },
                  reason: { type: "string" },
                },
                required: ["polymarketId", "kalshiId", "confidence", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["validations"],
          additionalProperties: false,
        },
        strict: true,
      },
    });
  } catch (err) {
    console.warn(
      "[ArbitrageScanner] LLM validation of external opportunities failed, keeping all:",
      err
    );
    return opportunities;
  }

  const parsed = JSON.parse(parseLLMText(result)) as {
    validations?: Array<{
      polymarketId: string;
      kalshiId: string;
      confidence: number;
      reason: string;
    }>;
  };
  const validationMap = new Map(
    (parsed.validations ?? []).map(v => [`${v.polymarketId}::${v.kalshiId}`, v])
  );

  const validated = opportunities.filter(o => {
    const key = `${o.polymarket.marketId}::${o.kalshi.marketId}`;
    const v = validationMap.get(key);
    if (!v) return true; // LLM didn't weigh in — keep it
    if (v.confidence < 0.75) {
      console.log(
        `[ArbitrageScanner] Dropped external arb (confidence=${v.confidence.toFixed(2)}): ${v.reason}`
      );
      return false;
    }
    // Boost or reduce the stored semanticMatchConfidence with LLM verdict
    o.semanticMatchConfidence = v.confidence;
    return true;
  });

  console.log(
    `[ArbitrageScanner] External LLM validation: ${opportunities.length} in → ${validated.length} passed`
  );
  return validated;
}

function buildIntent(
  market: AgentMarket,
  outcome: "yes" | "no",
  limitPrice: number
): TradeIntent {
  return {
    exchange: market.exchange,
    marketId: market.marketId,
    tokenId: outcome === "yes" ? market.yesTokenId : market.noTokenId,
    outcome,
    side: "buy",
    limitPrice,
    sizeUsd: 1,
    edge: 0,
    estimatedProbability: outcome === "yes" ? limitPrice : 1 - limitPrice,
    confidence: 1,
    rationale: ["cross_exchange_arbitrage"],
  };
}

export async function scanCrossExchangeArbitrage(
  markets: AgentMarket[],
  options: ArbitrageScanOptions = {}
): Promise<CrossExchangeArbitrageOpportunity[]> {
  const {
    maxTotalCost = 0.98,
    minLiquidityUsd = 0,
    minVolume24hUsd = 0,
    maxHoursToExpiry = 0,
  } = options;

  const now = Date.now();
  const expiryDeadline =
    maxHoursToExpiry > 0 ? now + maxHoursToExpiry * 3_600_000 : Infinity;

  function meetsFilters(market: AgentMarket): boolean {
    if (market.liquidity < minLiquidityUsd) return false;
    if (market.volume24h < minVolume24hUsd) return false;
    if (
      expiryDeadline !== Infinity &&
      market.expiresAt.getTime() > expiryDeadline
    )
      return false;
    return true;
  }

  const polymarkets = markets.filter(
    m => m.exchange === "polymarket" && meetsFilters(m)
  );
  const kalshiMarkets = markets.filter(
    m => m.exchange === "kalshi" && meetsFilters(m)
  );

  // ── Internal scanner: LLM semantic matching ──────────────────────────────
  const matches = await matchMarketsSemantically(polymarkets, kalshiMarkets);
  const byPolymarket = new Map(polymarkets.map(m => [m.marketId, m]));
  const byKalshi = new Map(kalshiMarkets.map(m => [m.marketId, m]));
  const opportunities: CrossExchangeArbitrageOpportunity[] = [];

  for (const match of matches) {
    const poly = byPolymarket.get(match.polymarketId);
    const kalshi = byKalshi.get(match.kalshiId);
    if (!poly || !kalshi) continue;
    const polymarketYesPrice = poly.bestAsk;
    const kalshiNoPrice = Math.max(0.01, Math.min(0.99, 1 - kalshi.bestBid));
    const totalCost = polymarketYesPrice + kalshiNoPrice;
    if (totalCost < maxTotalCost) {
      opportunities.push({
        anomalyType: "cross_exchange_arbitrage",
        source: "internal",
        polymarket: poly,
        kalshi,
        semanticMatchConfidence: match.confidence,
        polymarketYesPrice,
        kalshiNoPrice,
        gap: maxTotalCost - totalCost,
        intents: [
          buildIntent(poly, "yes", polymarketYesPrice),
          buildIntent(kalshi, "no", kalshiNoPrice),
        ],
      });
    }
  }

  // ── External feed: arbs.xyz + LLM validation ─────────────────────────────
  const internalKeys = new Set(
    opportunities.map(o => `${o.polymarket.marketId}::${o.kalshi.marketId}`)
  );
  const rawExternal = await fetchArbsXyzOpportunities();
  const newExternal = rawExternal.filter(
    o => !internalKeys.has(`${o.polymarket.marketId}::${o.kalshi.marketId}`)
  );

  // Run LLM validation on external opportunities before accepting them
  const validatedExternal = await validateExternalOpportunities(newExternal);
  for (const ext of validatedExternal) {
    opportunities.push(ext);
  }

  opportunities.sort((a, b) => b.gap - a.gap);
  console.log(
    `[ArbitrageScanner] llm_matched=${matches.length}; internal_arbs=${opportunities.filter(o => o.source === "internal").length}; external_validated=${validatedExternal.length}/${rawExternal.length}; threshold=${maxTotalCost}`
  );
  return opportunities;
}
