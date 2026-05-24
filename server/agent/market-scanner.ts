import { classifyMarketData, DEFAULT_RISK_LIMITS } from "./risk-manager";
import { scanPolymarketCandidates } from "./polymarket-client";
import type { AgentMarket, RiskLimits } from "./types";
import type { MarketScanOptions } from "./polymarket-client";

export interface ScannerResult {
  tradable: AgentMarket[];
  rejected: Array<{
    market: AgentMarket;
    reason: string;
  }>;
}

export const FAST_PLAY_MAX_EXPIRY_HOURS = 72;

const FAST_PLAY_CATEGORY_PATTERNS = [
  /weather/i,
  /economic/i,
  /economics/i,
  /cpi/i,
  /jobs?/i,
  /fed/i,
  /crypto/i,
  /bitcoin/i,
  /sports?/i,
  /game day/i,
];

export function computeHoursToExpiry(
  market: AgentMarket,
  now = new Date()
): number {
  return (market.expiresAt.getTime() - now.getTime()) / 3_600_000;
}

function fastPlayCategoryScore(market: AgentMarket): number {
  const haystack = `${market.category ?? ""} ${market.question} ${
    market.resolutionCriteria ?? ""
  }`;
  if (FAST_PLAY_CATEGORY_PATTERNS.some(pattern => pattern.test(haystack))) {
    if (
      /weather/i.test(haystack) ||
      /economic|economics|cpi|jobs|fed/i.test(haystack)
    ) {
      return 1;
    }
    if (/crypto|bitcoin/i.test(haystack)) return 0.9;
    if (/sports?/i.test(haystack)) return 0.8;
    return 0.7;
  }
  return 0;
}

export async function scanTradableMarkets(
  options: MarketScanOptions,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  now = new Date()
): Promise<ScannerResult> {
  const candidates = await scanPolymarketCandidates(options);
  const tradable: AgentMarket[] = [];
  const rejected: ScannerResult["rejected"] = [];

  for (const market of candidates) {
    const status = classifyMarketData(market, limits, now);
    const expiryHours = computeHoursToExpiry(market, now);
    if (status === "fresh" && expiryHours <= FAST_PLAY_MAX_EXPIRY_HOURS) {
      tradable.push(market);
    } else {
      rejected.push({
        market,
        reason:
          status === "fresh" && expiryHours > FAST_PLAY_MAX_EXPIRY_HOURS
            ? "Duration too long"
            : status,
      });
    }
  }

  tradable.sort((a, b) => {
    const categoryDelta = fastPlayCategoryScore(b) - fastPlayCategoryScore(a);
    if (categoryDelta !== 0) return categoryDelta;
    const expiryDelta =
      computeHoursToExpiry(a, now) - computeHoursToExpiry(b, now);
    if (expiryDelta !== 0) return expiryDelta;
    return b.volume24h - a.volume24h;
  });

  return { tradable, rejected };
}
