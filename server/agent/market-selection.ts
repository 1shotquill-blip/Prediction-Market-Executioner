import type { AgentMarket, EnsembleDecision, RiskDecision } from "./types";
import {
  getClobReferencePrice,
  computeMicrostructureScore,
} from "./book-pricing";
import type { KalshiRiskLimits } from "./risk-manager";
import { DEFAULT_KALSHI_RISK_LIMITS } from "./risk-manager";

export interface MarketSelectionWeights {
  edge: number;
  confidence: number;
  liquidity: number;
  timeRemaining: number;
  volumeVelocity: number;
  consensusDivergence: number;
  microstructure: number;
}

export const DEFAULT_MARKET_SELECTION_WEIGHTS: MarketSelectionWeights = {
  edge: 0.276,
  confidence: 0.23,
  liquidity: 0.092,
  timeRemaining: 0.092,
  volumeVelocity: 0.092,
  consensusDivergence: 0.138,
  microstructure: 0.08,
};

export interface MarketSelectionScore {
  total: number;
  edgeScore: number;
  confidenceScore: number;
  liquidityScore: number;
  timeRemainingScore: number;
  volumeVelocityScore: number;
  consensusDivergenceScore: number;
  microstructureScore: number;
  // gate results
  passedLiquidityGate: boolean;
  recencyPenalty: number;
}

// ─── Signal helpers ──────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeLiquidityScore(liquidityUsd: number): number {
  if (liquidityUsd <= 0) return 0;
  return clamp01(Math.log10(liquidityUsd + 1) / Math.log10(50_000 + 1));
}

// Signal 1: prefer 24–72 h window; penalise very short (<6h) and very long (>7d).
export function computeTimeRemainingScore(
  expiresAt: Date,
  now = new Date()
): number {
  const hoursRemaining = (expiresAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursRemaining <= 0) return 0;
  if (hoursRemaining < 6) return hoursRemaining / 6; // ramp up 0→1 over first 6h
  if (hoursRemaining <= 72) return 1; // sweet spot: 6h – 72h
  if (hoursRemaining <= 168) return 1 - (hoursRemaining - 72) / (168 - 72); // decay to 0 at 7d
  return 0;
}

// Signal 2: volume velocity — ratio of 1h volume annualised vs 24h run rate.
// >1 = accelerating, <1 = decelerating.
export function computeVolumeVelocityScore(
  volume24h: number,
  volume1h?: number
): number {
  if (volume1h === undefined || volume24h <= 0) return 0.5; // neutral when data absent
  const hourlyRunRate24h = volume24h / 24;
  const velocity = volume1h / hourlyRunRate24h;
  // clamp: 0 at 0.25x run rate, 1 at 3x run rate
  return clamp01((velocity - 0.25) / (3 - 0.25));
}

// Signal 3: recency bias penalty — discount if price hasn't moved in 6+ hours.
export function computeRecencyPenalty(
  lastPriceMovedAt: Date | undefined,
  orderbookUpdatedAt: Date,
  now = new Date()
): number {
  const reference = lastPriceMovedAt ?? orderbookUpdatedAt;
  const staleness = (now.getTime() - reference.getTime()) / 3_600_000;
  if (staleness < 6) return 1; // fresh — no penalty
  if (staleness >= 24) return 0.4; // very stale — 60% discount
  return clamp01(1 - ((staleness - 6) / (24 - 6)) * 0.6);
}

// Signal 4: minimum top-of-book depth gate.
export const MIN_TOP_OF_BOOK_USD = 500;

export function passesLiquidityGate(market: AgentMarket): boolean {
  const bid = market.topOfBookDepthBid ?? market.liquidity / 20;
  const ask = market.topOfBookDepthAsk ?? market.liquidity / 20;
  return bid >= MIN_TOP_OF_BOOK_USD && ask >= MIN_TOP_OF_BOOK_USD;
}

// Signal 5: consensus divergence — LLM estimate vs CLOB reference price.
// >15% gap = highest priority (score 1). Scales down below 15%.
export function computeConsensusDivergenceScore(
  estimatedProbability: number | undefined,
  referencePrice: number
): number {
  if (estimatedProbability === undefined) return 0;
  const gap = Math.abs(estimatedProbability - referencePrice);
  // 0.15 (15%) → score 1.0; scales linearly down to 0 at 0% gap.
  return clamp01(gap / 0.15);
}

// ─── Kalshi duration filter ───────────────────────────────────────────────────

export interface KalshiDurationFilterResult {
  allowed: boolean;
  reason?: string;
  /** Non-fatal warning when outside preferred window but still allowed */
  warning?: string;
}

/**
 * Filter Kalshi markets by time-to-expiry policy.
 *
 * Hard reject:  hoursToExpiry > limits.maxDaysToResolution * 24
 * Soft warn:    outside [preferredHoursMin, preferredHoursMax]
 */
export function filterKalshiMarketDuration(
  market: AgentMarket,
  now: Date = new Date(),
  limits: KalshiRiskLimits = DEFAULT_KALSHI_RISK_LIMITS
): KalshiDurationFilterResult {
  const hoursToExpiry =
    (market.expiresAt.getTime() - now.getTime()) / 3_600_000;

  if (hoursToExpiry <= 0) {
    return { allowed: false, reason: "rejected_duration_too_long" };
  }

  const hardLimitHours = limits.maxDaysToResolution * 24;
  if (hoursToExpiry > hardLimitHours) {
    return { allowed: false, reason: "rejected_duration_too_long" };
  }

  if (
    hoursToExpiry < limits.preferredHoursMin ||
    hoursToExpiry > limits.preferredHoursMax
  ) {
    return {
      allowed: true,
      warning: "preferred_range_miss",
    };
  }

  return { allowed: true };
}

// ─── Main scoring function ───────────────────────────────────────────────────

export function scoreOpportunity(
  market: AgentMarket,
  risk: RiskDecision,
  weights: MarketSelectionWeights = DEFAULT_MARKET_SELECTION_WEIGHTS,
  now = new Date(),
  ensemble?: EnsembleDecision
): MarketSelectionScore {
  // Gate 4: hard liquidity gate — zero total score if fails.
  const passedLiquidityGate = passesLiquidityGate(market);

  const edgeScore = clamp01(risk.diagnostics.selectedEdge / 0.2);
  const confidenceScore = clamp01(risk.intent?.confidence ?? 0);
  const liquidityScore = computeLiquidityScore(market.liquidity);
  const timeRemainingScore = computeTimeRemainingScore(market.expiresAt, now);
  const volumeVelocityScore = computeVolumeVelocityScore(
    market.volume24h,
    market.volume1h
  );
  const consensusDivergenceScore = computeConsensusDivergenceScore(
    ensemble?.estimatedProbability ?? risk.intent?.estimatedProbability,
    getClobReferencePrice(market)
  );
  const microstructureScore = computeMicrostructureScore(market);

  // Signal 3: recency penalty multiplied into total.
  const recencyPenalty = computeRecencyPenalty(
    market.lastPriceMovedAt,
    market.orderbookUpdatedAt,
    now
  );

  const rawTotal = passedLiquidityGate
    ? edgeScore * weights.edge +
      confidenceScore * weights.confidence +
      liquidityScore * weights.liquidity +
      timeRemainingScore * weights.timeRemaining +
      volumeVelocityScore * weights.volumeVelocity +
      consensusDivergenceScore * weights.consensusDivergence +
      microstructureScore * weights.microstructure
    : 0;

  return {
    total: rawTotal * recencyPenalty,
    edgeScore,
    confidenceScore,
    liquidityScore,
    timeRemainingScore,
    volumeVelocityScore,
    consensusDivergenceScore,
    microstructureScore,
    passedLiquidityGate,
    recencyPenalty,
  };
}
