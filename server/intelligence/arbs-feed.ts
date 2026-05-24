/**
 * Arbs.xyz external arbitrage feed.
 *
 * Fetches pre-calculated cross-exchange opportunities from arbs.xyz and maps
 * them into the internal CrossExchangeArbitrageOpportunity shape.  The site
 * does not publish a public REST API, so we scrape the JSON payload embedded
 * in the Next.js page (/__NEXT_DATA__ / fetch to the edge-rendered JSON
 * endpoint).  If ARBS_XYZ_API_KEY is set we try an undocumented `/api`
 * endpoint first, which is faster and more stable.
 *
 * All failures are non-fatal — the caller should .catch() and fall back to
 * the internal semantic scanner.
 */

import { ENV } from "../_core/env";
import type { AgentMarket } from "../agent/types";
import type { CrossExchangeArbitrageOpportunity } from "./arbitrage-scanner";

const ARBS_BASE = ENV.arbsXyzBaseUrl;
const ARBS_API_KEY = ENV.arbsXyzApiKey;

/** Canonical shape returned by the arbs.xyz API / scrape. */
interface ArbsOpportunity {
  polymarketId: string;
  kalshiId: string;
  polymarketYesPrice: number;
  kalshiNoPrice: number;
  gap: number;
  polymarketQuestion?: string;
  kalshiQuestion?: string;
  confidence?: number;
}

interface ArbsApiResponse {
  opportunities?: ArbsOpportunity[];
  data?: { opportunities?: ArbsOpportunity[] };
}

function buildPlaceholderMarket(
  marketId: string,
  question: string,
  exchange: "polymarket" | "kalshi",
  yesPrice: number,
  noPrice: number
): AgentMarket {
  return {
    exchange,
    marketId,
    question,
    yesTokenId: "",
    noTokenId: "",
    bestBid: Math.max(0.01, noPrice > 0 ? 1 - noPrice : yesPrice - 0.01),
    bestAsk: yesPrice,
    spread: 0.02,
    midpoint: yesPrice,
    volume24h: 0,
    volume1h: 0,
    liquidity: 0,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
    lastPriceMovedAt: new Date(),
    orderbookUpdatedAt: new Date(),
  };
}

function mapOpportunity(
  raw: ArbsOpportunity
): CrossExchangeArbitrageOpportunity | null {
  const { polymarketId, kalshiId, polymarketYesPrice, kalshiNoPrice, gap } =
    raw;
  if (!polymarketId || !kalshiId) return null;
  if (!Number.isFinite(polymarketYesPrice) || !Number.isFinite(kalshiNoPrice))
    return null;

  const polyQuestion = raw.polymarketQuestion ?? polymarketId;
  const kalshiQuestion = raw.kalshiQuestion ?? kalshiId;

  const polyMarket = buildPlaceholderMarket(
    polymarketId,
    polyQuestion,
    "polymarket",
    polymarketYesPrice,
    kalshiNoPrice
  );
  const kalshiMarket = buildPlaceholderMarket(
    kalshiId,
    kalshiQuestion,
    "kalshi",
    kalshiNoPrice,
    polymarketYesPrice
  );

  return {
    anomalyType: "cross_exchange_arbitrage",
    source: "arbs_xyz",
    polymarket: polyMarket,
    kalshi: kalshiMarket,
    semanticMatchConfidence: raw.confidence ?? 0.9,
    polymarketYesPrice,
    kalshiNoPrice,
    gap: gap ?? Math.max(0, 0.98 - (polymarketYesPrice + kalshiNoPrice)),
    intents: [
      {
        exchange: "polymarket",
        marketId: polymarketId,
        tokenId: "",
        outcome: "yes",
        side: "buy",
        limitPrice: polymarketYesPrice,
        sizeUsd: 1,
        edge: 0,
        estimatedProbability: polymarketYesPrice,
        confidence: raw.confidence ?? 0.9,
        rationale: ["cross_exchange_arbitrage", "arbs_xyz"],
      },
      {
        exchange: "kalshi",
        marketId: kalshiId,
        tokenId: "",
        outcome: "no",
        side: "buy",
        limitPrice: kalshiNoPrice,
        sizeUsd: 1,
        edge: 0,
        estimatedProbability: 1 - kalshiNoPrice,
        confidence: raw.confidence ?? 0.9,
        rationale: ["cross_exchange_arbitrage", "arbs_xyz"],
      },
    ],
  };
}

async function fetchViaApi(): Promise<ArbsOpportunity[]> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "PolyShore/1.0 arbitrage-feed",
  };
  if (ARBS_API_KEY) headers["X-Api-Key"] = ARBS_API_KEY;

  const res = await fetch(`${ARBS_BASE}/api/opportunities`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`arbs.xyz API ${res.status}`);
  const body = (await res.json()) as ArbsApiResponse;
  return body.opportunities ?? body.data?.opportunities ?? [];
}

async function fetchViaScrape(): Promise<ArbsOpportunity[]> {
  const res = await fetch(`${ARBS_BASE}/_next/data/index.json`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "PolyShore/1.0 arbitrage-feed",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`arbs.xyz scrape ${res.status}`);
  const body = (await res.json()) as {
    pageProps?: {
      opportunities?: ArbsOpportunity[];
      initialOpportunities?: ArbsOpportunity[];
    };
  };
  return (
    body.pageProps?.opportunities ?? body.pageProps?.initialOpportunities ?? []
  );
}

/**
 * Fetch arbitrage opportunities from arbs.xyz.
 * Tries the API endpoint first; falls back to Next.js data scraping.
 * Returns an empty array on any error so the caller can continue gracefully.
 */
export async function fetchArbsXyzOpportunities(): Promise<
  CrossExchangeArbitrageOpportunity[]
> {
  let raws: ArbsOpportunity[] = [];
  try {
    raws = ARBS_API_KEY
      ? await fetchViaApi()
      : await fetchViaScrape().catch(() => fetchViaApi());
  } catch (err) {
    console.warn("[ArbsFeed] fetch failed, skipping external feed:", err);
    return [];
  }

  const opportunities = raws
    .map(mapOpportunity)
    .filter((o): o is CrossExchangeArbitrageOpportunity => o !== null)
    .filter(o => o.gap > 0)
    .sort((a, b) => b.gap - a.gap);

  console.log(
    `[ArbsFeed] fetched ${opportunities.length} opportunities from arbs.xyz`
  );
  return opportunities;
}
