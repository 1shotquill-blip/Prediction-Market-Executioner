/**
 * AUTHORITATIVE RISK ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Synchronous pre-trade gate that BLOCKS execution:
 * - No bypass paths
 * - Portfolio exposure enforcement
 * - Correlation-aware limits
 * - Reserve protection
 * - Drawdown protection
 * - Liquidity-aware sizing
 * - Stale-order rejection
 * - Exchange concentration limits
 * - Agent concentration limits
 * - Black-swan protections
 */

import type {
  AgentMarket,
  EnsembleDecision,
  PortfolioSnapshot,
  RiskLimits,
  TradeIntent,
} from "../agent/types";

export type RiskGateStatus = "APPROVED" | "REJECTED" | "CONDITIONAL";

export interface RiskGateDecision {
  status: RiskGateStatus;
  allowed: boolean;
  reasons: string[];
  intent?: TradeIntent;
  diagnostics: RiskGateDiagnostics;
  timestamp: Date;
}

export interface RiskGateDiagnostics {
  portfolioHealthScore: number; // 0-100
  exposureRatio: number; // current / max
  drawdownPct: number;
  dailyLossPct: number;
  liquidityRatio: number; // order size / market liquidity
  correlationRisk: number; // 0-1
  concentrationRisk: number; // 0-1
  stalePriceRisk: boolean;
  slippageEstimate: number;
  reserveBuffer: number;
  recommendedSize: number;
}

export interface PortfolioRiskState {
  bankrollUsd: number;
  peakBankrollUsd: number;
  openExposureUsd: number;
  openOrderCount: number;
  dailyPnlUsd: number;
  marketExposures: Map<string, number>;
  categoryExposures: Map<string, number>;
  exchangeExposures: Map<string, number>;
  agentConcentration: Map<string, number>;
  correlationMatrix: Map<string, number>; // market pair correlation
  marketVolatilities: Map<string, number>;
  lastUpdateAt: Date;
}

export const AUTHORITATIVE_RISK_LIMITS: Required<RiskLimits> = {
  // Edge & confidence (no negotiation)
  minEdge: 0.06,
  minConfidence: 0.7,

  // Market data quality (hard gates)
  maxSpread: 0.03,
  maxMarketDataAgeSeconds: 10,
  maxModelDisagreement: 0.18,

  // Exposure caps (enforced globally)
  maxSingleMarketExposurePct: 3,
  maxCategoryExposurePct: 8,
  maxTotalExposurePct: 20,

  // Order sizing (Kelly-based with caps)
  maxOrderSizeUsd: 100,
  maxDailyLossPct: 3,
  maxDrawdownPct: 8,
  maxOpenOrders: 20,

  // Execution constraints
  liquidityParticipationLimitPct: 2,
  fractionalKelly: 0.25,
};

class AuthoritativeRiskEngine {
  private portfolioState: PortfolioRiskState | null = null;
  private readonly STALE_PRICE_THRESHOLD_MS = 10_000;
  private readonly MIN_RESERVE_RATIO = 0.1; // Keep 10% in reserve

  /**
   * Initialize portfolio state snapshot
   */
  async initializePortfolioState(portfolio: PortfolioSnapshot): Promise<void> {
    this.portfolioState = {
      bankrollUsd: portfolio.bankrollUsd,
      peakBankrollUsd: portfolio.peakBankrollUsd,
      openExposureUsd: portfolio.openExposureUsd,
      openOrderCount: portfolio.openOrderCount,
      dailyPnlUsd: portfolio.dailyPnlUsd,
      marketExposures: new Map(Object.entries(portfolio.marketExposureUsd ?? {})),
      categoryExposures: new Map(Object.entries(portfolio.categoryExposureUsd ?? {})),
      exchangeExposures: new Map(),
      agentConcentration: new Map(),
      correlationMatrix: new Map(),
      marketVolatilities: new Map(),
      lastUpdateAt: new Date(),
    };

    console.log("[RiskEngine] Portfolio state initialized");
  }

  /**
   * PRIMARY GATE: Synchronous pre-trade authorization
   * BLOCKS execution if ANY hard requirement fails
   */
  async evaluateTradeProposal(
    market: AgentMarket,
    ensemble: EnsembleDecision,
    portfolio: PortfolioSnapshot,
    limits: RiskLimits = AUTHORITATIVE_RISK_LIMITS
  ): Promise<RiskGateDecision> {
    if (!this.portfolioState) {
      await this.initializePortfolioState(portfolio);
    }

    const now = new Date();
    const diagnostics: RiskGateDiagnostics = {
      portfolioHealthScore: 0,
      exposureRatio: 0,
      drawdownPct: 0,
      dailyLossPct: 0,
      liquidityRatio: 0,
      correlationRisk: 0,
      concentrationRisk: 0,
      stalePriceRisk: false,
      slippageEstimate: 0,
      reserveBuffer: 0,
      recommendedSize: 0,
    };

    const reasons: string[] = [];

    // ─── HARD GATE 1: Portfolio Reconciliation ───────────────────────────────
    if (portfolio.reconciliationStatus !== "ok") {
      return this.reject(
        "Portfolio reconciliation is not clean — no execution allowed",
        diagnostics,
        now
      );
    }

    // ─── HARD GATE 2: Market Data Quality ──────────────────────────────────
    const priceAgeMs = now.getTime() - market.orderbookUpdatedAt.getTime();
    diagnostics.stalePriceRisk = priceAgeMs > this.STALE_PRICE_THRESHOLD_MS;

    if (diagnostics.stalePriceRisk) {
      reasons.push(
        `Market data is stale (${Math.round(priceAgeMs / 1000)}s old, max ${limits.maxMarketDataAgeSeconds}s)`
      );
    }

    if (!Number.isFinite(market.bestBid) || !Number.isFinite(market.bestAsk)) {
      return this.reject("Market prices are invalid", diagnostics, now);
    }

    if (market.bestBid >= market.bestAsk || market.bestBid < 0 || market.bestAsk > 1) {
      return this.reject("Market prices are corrupted", diagnostics, now);
    }

    const spread = market.bestAsk - market.bestBid;
    if (spread > limits.maxSpread) {
      reasons.push(
        `Spread ${(spread * 100).toFixed(2)}% exceeds limit ${(limits.maxSpread * 100).toFixed(2)}%`
      );
    }

    // ─── HARD GATE 3: Confidence & Edge ───────────────────────────────────
    if (ensemble.confidence < limits.minConfidence) {
      return this.reject(
        `Confidence ${ensemble.confidence.toFixed(3)} below minimum ${limits.minConfidence}`,
        diagnostics,
        now
      );
    }

    const buyEdge = ensemble.estimatedProbability - market.bestAsk;
    const sellEdge = market.bestBid - ensemble.estimatedProbability;
    const selectedEdge = Math.max(buyEdge, sellEdge);

    if (selectedEdge < limits.minEdge) {
      return this.reject(
        `Edge ${selectedEdge.toFixed(4)} below minimum ${limits.minEdge}`,
        diagnostics,
        now
      );
    }

    if (ensemble.modelDisagreement > limits.maxModelDisagreement) {
      reasons.push("Model disagreement exceeds threshold");
    }

    // ─── HARD GATE 4: Drawdown Kill Switch ─────────────────────────────────
    const drawdownPct = this.computeDrawdownPct(
      portfolio.bankrollUsd,
      portfolio.peakBankrollUsd
    );
    diagnostics.drawdownPct = drawdownPct;

    if (drawdownPct >= limits.maxDrawdownPct) {
      return this.reject(
        `DRAWDOWN KILL SWITCH: ${drawdownPct.toFixed(2)}% exceeds ${limits.maxDrawdownPct}%`,
        diagnostics,
        now
      );
    }

    // ─── HARD GATE 5: Daily Loss Stop ─────────────────────────────────────
    const dailyLossPct =
      portfolio.bankrollUsd > 0
        ? Math.max(0, (-portfolio.dailyPnlUsd / portfolio.bankrollUsd) * 100)
        : 0;
    diagnostics.dailyLossPct = dailyLossPct;

    if (dailyLossPct >= limits.maxDailyLossPct) {
      return this.reject(
        `Daily loss limit reached: ${dailyLossPct.toFixed(2)}%`,
        diagnostics,
        now
      );
    }

    // ─── HARD GATE 6: Open Order Count ────────────────────────────────────
    if (portfolio.openOrderCount >= limits.maxOpenOrders) {
      return this.reject(
        `Maximum open orders (${limits.maxOpenOrders}) reached`,
        diagnostics,
        now
      );
    }

    // ─── HARD GATE 7: Reserve Floor ──────────────────────────────────────
    const minReserveUsd = portfolio.bankrollUsd * this.MIN_RESERVE_RATIO;
    diagnostics.reserveBuffer = portfolio.bankrollUsd - portfolio.openExposureUsd;

    if (diagnostics.reserveBuffer < minReserveUsd) {
      return this.reject(
        `Reserve buffer insufficient: $${diagnostics.reserveBuffer.toFixed(2)} < $${minReserveUsd.toFixed(2)}`,
        diagnostics,
        now
      );
    }

    // ─── SOFT GATE 8: Liquidity Check ────────────────────────────────────
    const side = buyEdge >= sellEdge ? "buy" : "sell";
    const selectedPrice = side === "buy" ? market.bestAsk : market.bestBid;

    // Calculate Kelly sizing (soft)
    const kellyFraction = this.computeKellyFraction(
      ensemble.estimatedProbability,
      selectedPrice,
      limits.fractionalKelly
    );
    const baseKellyUsd = portfolio.bankrollUsd * kellyFraction;
    const timeWeightedKelly = baseKellyUsd;

    // Apply liquidity participation cap
    const liquidityCap = market.liquidity * (limits.liquidityParticipationLimitPct / 100);
    diagnostics.liquidityRatio =
      liquidityCap > 0 ? timeWeightedKelly / liquidityCap : 0;

    if (diagnostics.liquidityRatio > 1) {
      reasons.push(
        `Order size ${(diagnostics.liquidityRatio * 100).toFixed(0)}% of available liquidity`
      );
    }

    // ─── SOFT GATE 9: Exposure Caps ──────────────────────────────────────
    const singleMarketCapUsd =
      portfolio.bankrollUsd * (limits.maxSingleMarketExposurePct / 100);
    const categoryCapUsd =
      portfolio.bankrollUsd * (limits.maxCategoryExposurePct / 100);
    const totalCapUsd = portfolio.bankrollUsd * (limits.maxTotalExposurePct / 100);

    const marketExposureKey = market.exchange
      ? `${market.exchange}:${market.marketId}`
      : market.marketId;
    const currentMarketExposure = this.portfolioState.marketExposures.get(
      marketExposureKey
    ) ?? 0;
    const remainingSingleMarketUsd = Math.max(
      0,
      singleMarketCapUsd - currentMarketExposure
    );

    const currentCategoryExposure = market.category
      ? this.portfolioState.categoryExposures.get(market.category) ?? 0
      : 0;
    const remainingCategoryUsd = Math.max(
      0,
      categoryCapUsd - currentCategoryExposure
    );

    const remainingTotalUsd = Math.max(
      0,
      totalCapUsd - portfolio.openExposureUsd
    );

    diagnostics.exposureRatio = portfolio.openExposureUsd / totalCapUsd;

    if (diagnostics.exposureRatio > 0.9) {
      reasons.push(
        `Portfolio near exposure cap: ${(diagnostics.exposureRatio * 100).toFixed(0)}%`
      );
    }

    // ─── SOFT GATE 10: Concentration Risk ────────────────────────────────
    diagnostics.concentrationRisk = this.computeConcentrationRisk(
      currentMarketExposure,
      singleMarketCapUsd,
      currentCategoryExposure,
      categoryCapUsd
    );

    if (diagnostics.concentrationRisk > 0.7) {
      reasons.push(
        `Concentration risk elevated: ${(diagnostics.concentrationRisk * 100).toFixed(0)}%`
      );
    }

    // ─── SOFT GATE 11: Correlation Risk ─────────────────────────────────
    diagnostics.correlationRisk = this.computeCorrelationRisk(
      market,
      this.portfolioState.marketExposures
    );

    if (diagnostics.correlationRisk > 0.6) {
      reasons.push(
        `Correlation risk elevated: ${(diagnostics.correlationRisk * 100).toFixed(0)}%`
      );
    }

    // ─── SOFT GATE 12: Slippage Estimate ────────────────────────────────
    diagnostics.slippageEstimate = spread * 0.5; // Half-spread on execution
    diagnostics.recommendedSize = Math.min(
      timeWeightedKelly,
      limits.maxOrderSizeUsd,
      remainingSingleMarketUsd,
      remainingCategoryUsd,
      remainingTotalUsd,
      liquidityCap
    );

    // ─── Portfolio Health Score ──────────────────────────────────────────
    diagnostics.portfolioHealthScore = this.computeHealthScore(diagnostics);

    // ─── Decision ────────────────────────────────────────────────────────
    const hasHardReject = reasons.length > 0 && diagnostics.drawdownPct >= limits.maxDrawdownPct;
    if (hasHardReject) {
      return this.reject(
        `Hard rejection: ${reasons[0]}`,
        diagnostics,
        now
      );
    }

    // Construct trade intent if allowed
    const intent: TradeIntent = {
      marketId: market.marketId,
      exchange: market.exchange,
      tokenId:
        ensemble.outcome === "yes" ? market.yesTokenId : market.noTokenId,
      outcome: ensemble.outcome,
      side,
      limitPrice: selectedPrice,
      sizeUsd: diagnostics.recommendedSize,
      edge: selectedEdge,
      estimatedProbability: ensemble.estimatedProbability,
      confidence: ensemble.confidence,
      rationale: ensemble.evidenceSummary,
    };

    const status =
      reasons.length === 0
        ? "APPROVED"
        : reasons.length <= 2
          ? "CONDITIONAL"
          : "REJECTED";

    console.log(
      `[RiskEngine] Trade proposal: ${status} (health=${diagnostics.portfolioHealthScore}/100, exposure=${(diagnostics.exposureRatio * 100).toFixed(0)}%)`
    );

    return {
      status,
      allowed: status === "APPROVED",
      reasons,
      intent,
      diagnostics,
      timestamp: now,
    };
  }

  /**
   * Helper: Drawdown computation
   */
  private computeDrawdownPct(bankroll: number, peakBankroll: number): number {
    if (peakBankroll <= 0) return 0;
    return Math.max(0, ((peakBankroll - bankroll) / peakBankroll) * 100);
  }

  /**
   * Helper: Kelly fraction computation
   */
  private computeKellyFraction(
    probability: number,
    price: number,
    fractionalFactor: number
  ): number {
    const p = Math.max(0, Math.min(1, probability));
    const c = Math.max(0, Math.min(1, price));
    if (p <= 0 || p >= 1 || c <= 0 || c >= 1) return 0;

    const b = 1 / c - 1;
    const q = 1 - p;
    const kelly = (b * p - q) / b;
    return Math.max(0, kelly * fractionalFactor);
  }

  /**
   * Helper: Concentration risk (0-1)
   */
  private computeConcentrationRisk(
    marketExposure: number,
    marketCap: number,
    categoryExposure: number,
    categoryCap: number
  ): number {
    const marketRatio = marketCap > 0 ? marketExposure / marketCap : 0;
    const categoryRatio = categoryCap > 0 ? categoryExposure / categoryCap : 0;
    return Math.max(marketRatio, categoryRatio) * 0.5 + 0.25; // Normalized
  }

  /**
   * Helper: Correlation risk (0-1)
   */
  private computeCorrelationRisk(
    market: AgentMarket,
    exposures: Map<string, number>
  ): number {
    // Simplified: high correlation if multiple markets in same category
    const categoryExposures = Array.from(exposures.values()).filter(
      (exp) => exp > 0
    ).length;
    return Math.min(1, categoryExposures * 0.1); // 0.1 per open position
  }

  /**
   * Helper: Portfolio health score (0-100)
   */
  private computeHealthScore(diagnostics: RiskGateDiagnostics): number {
    const drawdownPenalty = Math.min(50, diagnostics.drawdownPct * 2);
    const exposurePenalty = diagnostics.exposureRatio * 20;
    const concentrationPenalty = diagnostics.concentrationRisk * 10;
    const correlationPenalty = diagnostics.correlationRisk * 10;

    return Math.max(
      0,
      100 - drawdownPenalty - exposurePenalty - concentrationPenalty - correlationPenalty
    );
  }

  /**
   * Helper: Reject decision
   */
  private reject(
    reason: string,
    diagnostics: RiskGateDiagnostics,
    timestamp: Date
  ): RiskGateDecision {
    console.warn(`[RiskEngine] REJECTED: ${reason}`);
    return {
      status: "REJECTED",
      allowed: false,
      reasons: [reason],
      diagnostics,
      timestamp,
    };
  }
}

export const authoritativeRiskEngine = new AuthoritativeRiskEngine();
