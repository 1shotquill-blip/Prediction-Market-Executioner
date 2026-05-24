import type { AgentMarket } from "./types";

function clampFinitePrice(value: number): number {
  return Number.isFinite(value) ? value : Number.NaN;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function getClobReferencePrice(market: AgentMarket): number {
  const bestBid = clampFinitePrice(market.bestBid);
  const bestAsk = clampFinitePrice(market.bestAsk);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return Number.NaN;
  if (bestBid < 0 || bestAsk > 1 || bestBid >= bestAsk) return Number.NaN;
  return (bestBid + bestAsk) / 2;
}

export function getClobSpreadBps(market: AgentMarket): number {
  const referencePrice = getClobReferencePrice(market);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (market.spread / referencePrice) * 10_000;
}

// ─── Order book microstructure signals ───────────────────────────────────────

/**
 * Book imbalance ratio: (bid depth - ask depth) / (bid depth + ask depth).
 * Range: -1 to +1. Positive = buy pressure. Returns 0 if depth data missing.
 */
export function computeBookImbalanceRatio(market: AgentMarket): number {
  const bid = market.topOfBookDepthBid;
  const ask = market.topOfBookDepthAsk;
  if (bid === undefined || ask === undefined) return 0;
  const sum = bid + ask;
  if (sum === 0) return 0;
  return (bid - ask) / sum;
}

/**
 * Depth decay slope proxy: spread / avg_depth.
 * Inverted so higher score = better (tighter spread relative to depth).
 * Returns 0 if depth data missing.
 */
export function computeDepthDecaySlope(market: AgentMarket): number {
  const bid = market.topOfBookDepthBid;
  const ask = market.topOfBookDepthAsk;
  if (bid === undefined || ask === undefined) return 0;
  const avgDepth = (bid + ask) / 2;
  const slope = market.spread / Math.max(0.001, avgDepth);
  return 1 - clamp01(slope / 0.1);
}

/**
 * Aggressive fill ratio proxy: volume1h vs 10% of liquidity.
 * Higher = more taker activity = better signal.
 * Returns 0.5 (neutral) if volume1h undefined.
 */
export function computeAggressiveFillRatio(market: AgentMarket): number {
  if (market.volume1h === undefined) return 0.5;
  return clamp01(market.volume1h / Math.max(1, market.liquidity * 0.1));
}

/**
 * Combined microstructure score [0, 1].
 * Weights: imbalance magnitude 0.4, depth decay 0.3, aggressive fill 0.3.
 */
export function computeMicrostructureScore(market: AgentMarket): number {
  const imbalance = computeBookImbalanceRatio(market);
  const depthDecaySlope = computeDepthDecaySlope(market);
  const aggressiveFillRatio = computeAggressiveFillRatio(market);
  const raw =
    Math.abs(imbalance) * 0.4 +
    depthDecaySlope * 0.3 +
    aggressiveFillRatio * 0.3;
  return clamp01(raw);
}
