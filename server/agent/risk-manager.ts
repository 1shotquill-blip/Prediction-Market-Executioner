import type {
  AgentMarket,
  EnsembleDecision,
  MarketDataStatus,
  PortfolioSnapshot,
  RiskDecision,
  RiskLimits,
  TradeIntent,
} from "./types";
import { computeExecutionMicrostructureProfile } from "./execution-microstructure";

// ─── Micro-bankroll risk policy (Kalshi ~$20 bankroll) ───────────────────────

export interface KalshiRiskLimits {
  maxPositionUsd: number; // normal cap (default $2)
  absoluteMaxPositionUsd: number; // hard cap (default $3)
  maxTotalExposureUsd: number; // total open exposure cap (default $8)
  maxDailyLossUsd: number; // daily loss stop (default $3)
  minBankrollReserveUsd: number; // must remain uncommitted (default $10)
  maxDaysToResolution: number; // hard reject if > N days (default 2)
  preferredHoursMin: number; // soft warn below (default 6)
  preferredHoursMax: number; // soft warn above (default 48)
}

export const DEFAULT_KALSHI_RISK_LIMITS: KalshiRiskLimits = {
  maxPositionUsd: 2,
  absoluteMaxPositionUsd: 3,
  maxTotalExposureUsd: 8,
  maxDailyLossUsd: 3,
  minBankrollReserveUsd: 10,
  maxDaysToResolution: 2,
  preferredHoursMin: 6,
  preferredHoursMax: 48,
};

export function computeKalshiPositionSize(
  bankroll: number,
  confidence: number,
  limits: KalshiRiskLimits
): number {
  const base = Math.min(limits.maxPositionUsd, bankroll * 0.1);
  const highConf = Math.min(limits.absoluteMaxPositionUsd, bankroll * 0.15);
  const size = confidence >= 0.85 ? highConf : base;
  return Math.min(size, limits.absoluteMaxPositionUsd); // hard cap $3
}

export interface MicroBankrollRiskInput {
  sizeUsd: number;
  bankrollUsd: number;
  currentTotalExposureUsd: number;
  dailyLossUsd: number;
  hoursToResolution: number;
  confidence: number;
}

export interface MicroBankrollRiskDecision {
  allowed: boolean;
  rejectionReason?: string;
  adjustedSizeUsd?: number;
}

/** Bankroll floor = reserve + daily loss stop */
function bankrollFloor(limits: KalshiRiskLimits): number {
  return limits.minBankrollReserveUsd + limits.maxDailyLossUsd;
}

/**
 * Evaluate a proposed Kalshi trade against micro-bankroll safety rules.
 * All hard rules must pass or the trade is rejected with a specific reason.
 */
export function evaluateKalshiMicroBankrollRisk(
  input: MicroBankrollRiskInput,
  limits: KalshiRiskLimits = DEFAULT_KALSHI_RISK_LIMITS
): MicroBankrollRiskDecision {
  const {
    sizeUsd,
    bankrollUsd,
    currentTotalExposureUsd,
    dailyLossUsd,
    hoursToResolution,
  } = input;

  // 1. Hard cap on individual position size
  if (sizeUsd > limits.absoluteMaxPositionUsd) {
    return { allowed: false, rejectionReason: "rejected_size_hard_cap" };
  }

  // 2. Total exposure cap
  if (currentTotalExposureUsd + sizeUsd > limits.maxTotalExposureUsd) {
    return { allowed: false, rejectionReason: "rejected_exposure_cap" };
  }

  // 3. Reserve floor — must keep minBankrollReserveUsd uncommitted
  if (bankrollUsd - sizeUsd < limits.minBankrollReserveUsd) {
    return { allowed: false, rejectionReason: "rejected_reserve_floor" };
  }

  // 4. Daily loss stop
  if (dailyLossUsd >= limits.maxDailyLossUsd) {
    return { allowed: false, rejectionReason: "rejected_daily_loss_limit" };
  }

  // 5. Bankroll floor (reserve + daily stop)
  if (bankrollUsd < bankrollFloor(limits)) {
    return { allowed: false, rejectionReason: "rejected_bankroll_floor" };
  }

  // 6. Duration hard reject (> 2 days)
  if (hoursToResolution > limits.maxDaysToResolution * 24) {
    return { allowed: false, rejectionReason: "rejected_duration_too_long" };
  }

  return { allowed: true, adjustedSizeUsd: sizeUsd };
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  minEdge: 0.06,
  minConfidence: 0.7,
  maxSpread: 0.03,
  maxMarketDataAgeSeconds: 10,
  maxModelDisagreement: 0.18,
  maxSingleMarketExposurePct: 3,
  maxCategoryExposurePct: 8,
  maxTotalExposurePct: 20,
  maxOrderSizeUsd: 100,
  maxDailyLossPct: 3,
  maxDrawdownPct: 8,
  maxOpenOrders: 20,
  liquidityParticipationLimitPct: 2,
  fractionalKelly: 0.25,
};

export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function computeBinaryKellyFraction(
  probability: number,
  price: number
): number {
  const p = clampProbability(probability);
  const c = clampProbability(price);
  if (p <= 0 || p >= 1 || c <= 0 || c >= 1) return 0;

  const b = 1 / c - 1;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  return Math.max(0, kelly);
}

export function computeDrawdownPct(
  bankrollUsd: number,
  peakBankrollUsd: number
): number {
  if (peakBankrollUsd <= 0) return 0;
  return Math.max(0, ((peakBankrollUsd - bankrollUsd) / peakBankrollUsd) * 100);
}

export function computeResolutionSpeedMultiplier(
  expiresAt: Date,
  now = new Date()
): number {
  const hoursToExpiry = (expiresAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursToExpiry <= 0) return 0;
  if (hoursToExpiry <= 24) return 2.5;
  if (hoursToExpiry >= 72) return 1;
  return 1 + ((72 - hoursToExpiry) / (72 - 24)) * 1.5;
}

export function classifyMarketData(
  market: AgentMarket,
  limits: RiskLimits,
  now = new Date()
): MarketDataStatus {
  const ageSeconds =
    (now.getTime() - market.orderbookUpdatedAt.getTime()) / 1000;
  if (!Number.isFinite(market.bestBid) || !Number.isFinite(market.bestAsk))
    return "invalid";
  if (
    market.bestBid < 0 ||
    market.bestAsk > 1 ||
    market.bestBid >= market.bestAsk
  )
    return "invalid";
  if (ageSeconds > limits.maxMarketDataAgeSeconds) return "stale";
  if (market.spread > limits.maxSpread) return "wide_spread";
  if (market.liquidity <= 0 || market.volume24h <= 0) return "illiquid";
  return "fresh";
}

export function evaluateRisk(
  market: AgentMarket,
  ensemble: EnsembleDecision,
  portfolio: PortfolioSnapshot,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  now = new Date()
): RiskDecision {
  const reasons: string[] = [];
  const marketDataStatus = classifyMarketData(market, limits, now);
  const buyEdge = ensemble.estimatedProbability - market.bestAsk;
  const sellEdge = market.bestBid - ensemble.estimatedProbability;
  const shouldBuy = buyEdge >= sellEdge;
  const selectedEdge = shouldBuy ? buyEdge : sellEdge;
  const selectedPrice = shouldBuy ? market.bestAsk : market.bestBid;
  const tokenId =
    ensemble.outcome === "yes" ? market.yesTokenId : market.noTokenId;
  const drawdownPct = computeDrawdownPct(
    portfolio.bankrollUsd,
    portfolio.peakBankrollUsd
  );
  const dailyLossPct =
    portfolio.bankrollUsd > 0
      ? Math.max(0, (-portfolio.dailyPnlUsd / portfolio.bankrollUsd) * 100)
      : 0;

  if (portfolio.reconciliationStatus !== "ok")
    reasons.push("portfolio reconciliation is not clean");
  if (marketDataStatus !== "fresh")
    reasons.push(`market data is ${marketDataStatus}`);
  if (selectedEdge < limits.minEdge)
    reasons.push(
      `edge ${selectedEdge.toFixed(4)} below minimum ${limits.minEdge}`
    );
  if (ensemble.confidence < limits.minConfidence)
    reasons.push(
      `confidence ${ensemble.confidence.toFixed(4)} below minimum ${limits.minConfidence}`
    );
  if (ensemble.modelDisagreement > limits.maxModelDisagreement)
    reasons.push("model disagreement exceeds limit");
  if (drawdownPct >= limits.maxDrawdownPct)
    reasons.push("drawdown kill switch is active");
  if (dailyLossPct >= limits.maxDailyLossPct)
    reasons.push("daily loss limit is reached");
  if (portfolio.openOrderCount >= limits.maxOpenOrders)
    reasons.push("open order limit is reached");

  const rawKelly = computeBinaryKellyFraction(
    ensemble.estimatedProbability,
    selectedPrice
  );
  const baseKelly = rawKelly * ensemble.confidence * limits.fractionalKelly;
  const disagreementMultiplier =
    ensemble.modelDisagreement > 0.15
      ? 0.5
      : ensemble.modelDisagreement <= 0.05
        ? 1.25
        : 1.0;
  const confidenceAdjustedKelly = Math.min(
    baseKelly * disagreementMultiplier,
    0.5
  );
  const kellySizeUsd = portfolio.bankrollUsd * confidenceAdjustedKelly;
  const resolutionSpeedMultiplier = computeResolutionSpeedMultiplier(
    market.expiresAt,
    now
  );
  const timeWeightedKellyUsd = kellySizeUsd * resolutionSpeedMultiplier;
  const singleMarketCapUsd =
    portfolio.bankrollUsd * (limits.maxSingleMarketExposurePct / 100);
  const categoryCapUsd =
    portfolio.bankrollUsd * (limits.maxCategoryExposurePct / 100);
  const totalCapUsd =
    portfolio.bankrollUsd * (limits.maxTotalExposurePct / 100);
  const liquidityCapUsd =
    market.liquidity * (limits.liquidityParticipationLimitPct / 100);
  const executionProfile = computeExecutionMicrostructureProfile(market, now);
  const executionAdjustedKellyUsd =
    timeWeightedKellyUsd * executionProfile.sizeMultiplier;

  const marketExposureKey = market.exchange
    ? `${market.exchange}:${market.marketId}`
    : market.marketId;
  const categoryExposureKey =
    market.exchange && market.category
      ? `${market.exchange}:${market.category}`
      : market.category;
  const currentMarketExposure =
    portfolio.marketExposureUsd[marketExposureKey] ??
    portfolio.marketExposureUsd[market.marketId] ??
    0;
  const currentCategoryExposure = market.category
    ? (portfolio.categoryExposureUsd[categoryExposureKey ?? market.category] ??
      portfolio.categoryExposureUsd[market.category] ??
      0)
    : 0;
  const remainingSingleMarketUsd = Math.max(
    0,
    singleMarketCapUsd - currentMarketExposure
  );
  const remainingCategoryUsd = Math.max(
    0,
    categoryCapUsd - currentCategoryExposure
  );
  const remainingTotalUsd = Math.max(
    0,
    totalCapUsd - portfolio.openExposureUsd
  );
  const cappedSizeUsd = Math.min(
    executionAdjustedKellyUsd,
    limits.maxOrderSizeUsd,
    remainingSingleMarketUsd,
    remainingCategoryUsd,
    remainingTotalUsd,
    liquidityCapUsd
  );

  if (cappedSizeUsd <= 0)
    reasons.push("position size reduced to zero by risk caps");

  const intent: TradeIntent | undefined =
    reasons.length === 0
      ? {
          marketId: market.marketId,
          exchange: market.exchange,
          tokenId,
          outcome: ensemble.outcome,
          side: shouldBuy ? "buy" : "sell",
          limitPrice: selectedPrice,
          sizeUsd: cappedSizeUsd,
          edge: selectedEdge,
          estimatedProbability: ensemble.estimatedProbability,
          confidence: ensemble.confidence,
          rationale: ensemble.evidenceSummary,
        }
      : undefined;

  return {
    allowed: reasons.length === 0,
    reasons,
    intent,
    diagnostics: {
      buyEdge,
      sellEdge,
      selectedEdge,
      kellyFraction: confidenceAdjustedKelly,
      cappedSizeUsd,
      drawdownPct,
      marketDataStatus,
      executionMultiplier: executionProfile.sizeMultiplier,
      resolutionSpeedMultiplier,
    },
  };
}

export interface SimulatedRiskDecision extends RiskDecision {
  simulatedAt: Date;
}

/**
 * Simulate a risk decision for a market and ensemble, without performing any side effects.
 * Useful for "dry-run" dashboard features.
 */
export function simulateRisk(
  market: AgentMarket,
  ensemble: EnsembleDecision,
  portfolio: PortfolioSnapshot,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
  now = new Date()
): SimulatedRiskDecision {
  const result = evaluateRisk(market, ensemble, portfolio, limits, now);
  return {
    ...result,
    simulatedAt: now,
  };
}
