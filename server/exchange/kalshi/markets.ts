import { ENV } from "../../_core/env";
import type { AgentMarket } from "../../agent/types";
import { KalshiClient } from "./client";

export interface KalshiMarketRaw {
  ticker: string;
  title?: string;
  subtitle?: string;
  category?: string;
  close_time?: string;
  expiration_time?: string;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  volume?: number;
  volume_24h?: number;
  liquidity?: number;
  open_interest?: number;
  status?: string;
}

export interface KalshiMarketsResponse {
  markets?: KalshiMarketRaw[];
  market?: KalshiMarketRaw;
}

function centsToProbability(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0.01, Math.min(0.99, number / 100));
}

export function normalizeKalshiMarket(raw: KalshiMarketRaw): AgentMarket {
  const bestBid = centsToProbability(raw.yes_bid, 0.01);
  const bestAsk = centsToProbability(raw.yes_ask, 0.99);
  const expiresAt = new Date(
    raw.close_time ?? raw.expiration_time ?? Date.now() + 24 * 60 * 60 * 1000
  );
  return {
    exchange: "kalshi",
    marketId: raw.ticker,
    question: raw.title ?? raw.subtitle ?? raw.ticker,
    resolutionCriteria: raw.subtitle,
    category: raw.category,
    yesTokenId: `${raw.ticker}:yes`,
    noTokenId: `${raw.ticker}:no`,
    bestBid,
    bestAsk,
    spread: Math.max(0, bestAsk - bestBid),
    midpoint: (bestBid + bestAsk) / 2,
    volume24h: Number(raw.volume_24h ?? raw.volume ?? 0),
    liquidity: Number(raw.liquidity ?? raw.open_interest ?? 0),
    expiresAt,
    orderbookUpdatedAt: new Date(),
  };
}

export async function listKalshiMarkets(
  client = new KalshiClient(),
  options: { limit?: number; cursor?: string; status?: string } = {}
): Promise<AgentMarket[]> {
  // In paper mode without credentials, return empty list gracefully
  if (ENV.kalshiExecutionMode !== "live") {
    return [];
  }
  const params = new URLSearchParams({
    limit: String(options.limit ?? 100),
    status: options.status ?? "open",
  });
  if (options.cursor) params.set("cursor", options.cursor);
  const body = await client.request<KalshiMarketsResponse>(
    `/markets?${params}`,
    { authenticated: false }
  );
  return (body.markets ?? []).map(normalizeKalshiMarket);
}

export async function getKalshiMarket(
  ticker: string,
  client = new KalshiClient()
): Promise<AgentMarket> {
  const body = await client.request<KalshiMarketsResponse>(
    `/markets/${encodeURIComponent(ticker)}`,
    { authenticated: false }
  );
  const raw = body.market ?? body.markets?.[0];
  if (!raw) throw new Error(`Kalshi market not found: ${ticker}`);
  return normalizeKalshiMarket(raw);
}
