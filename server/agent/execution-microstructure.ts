import type { AgentMarket, TradeIntent } from "./types";
import { getClobSpreadBps } from "./book-pricing";

export interface ExecutionMicrostructureProfile {
  spreadBps: number;
  depthUsd: number;
  ageSeconds: number;
  sizeMultiplier: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function computeDepthUsd(market: AgentMarket): number {
  const fallback = market.liquidity > 0 ? market.liquidity / 20 : 0;
  const bidDepth = market.topOfBookDepthBid ?? fallback;
  const askDepth = market.topOfBookDepthAsk ?? fallback;
  return Math.max(0, Math.min(bidDepth, askDepth));
}

export function computeExecutionMicrostructureProfile(
  market: AgentMarket,
  now = new Date()
): ExecutionMicrostructureProfile {
  const spreadBps = getClobSpreadBps(market);
  const depthUsd = computeDepthUsd(market);
  const ageSeconds =
    (now.getTime() - market.orderbookUpdatedAt.getTime()) / 1_000;

  const spreadScore = clamp01(1 - spreadBps / 500);
  const depthScore = clamp01(Math.log10(depthUsd + 1) / Math.log10(10_000));
  const freshnessScore = clamp01(1 - ageSeconds / 3_600);

  const sizeMultiplier = Math.max(
    0.25,
    Math.min(
      1,
      0.3 + depthScore * 0.45 + spreadScore * 0.2 + freshnessScore * 0.05
    )
  );

  return {
    spreadBps,
    depthUsd,
    ageSeconds,
    sizeMultiplier,
  };
}

export function applyExecutionMicrostructure(
  intent: TradeIntent,
  market: AgentMarket,
  now = new Date()
): TradeIntent {
  const profile = computeExecutionMicrostructureProfile(market, now);
  return {
    ...intent,
    sizeUsd: intent.sizeUsd * profile.sizeMultiplier,
  };
}
