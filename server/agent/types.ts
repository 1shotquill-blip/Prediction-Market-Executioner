export type OutcomeSide = "yes" | "no";
export type TradeSide = "buy" | "sell";
export type ExecutionMode = "paper" | "live";
export type ExchangeId = "polymarket" | "kalshi";

export type MarketDataStatus =
  | "fresh"
  | "stale"
  | "illiquid"
  | "wide_spread"
  | "invalid";

export interface AgentMarket {
  exchange?: ExchangeId;
  marketId: string;
  conditionId?: string;
  question: string;
  resolutionCriteria?: string;
  category?: string;
  yesTokenId: string;
  noTokenId: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  midpoint: number;
  volume24h: number;
  volume1h?: number;
  liquidity: number;
  topOfBookDepthBid?: number;
  topOfBookDepthAsk?: number;
  lastPriceMovedAt?: Date;
  expiresAt: Date;
  orderbookUpdatedAt: Date;
  negRisk?: boolean;
}

export interface ProbabilityEstimate {
  source: string;
  probability: number;
  confidence: number;
  evidence: string[];
  freshnessSeconds: number;
  failureReason?: string;
  socialSignals?: SocialSignal[];
}

export interface SocialSignal {
  id: string;
  text: string;
  author_id: string;
  author_username: string;
  created_at: string;
  metrics: {
    likes: number;
    retweets: number;
    replies: number;
  };
  sentiment_score?: number;
}

export interface EnsembleDecision {
  marketId: string;
  outcome: OutcomeSide;
  estimatedProbability: number;
  confidence: number;
  estimates: ProbabilityEstimate[];
  modelDisagreement: number;
  evidenceSummary: string[];
  generatedAt: Date;
}

export interface PortfolioSnapshot {
  bankrollUsd: number;
  peakBankrollUsd: number;
  openExposureUsd: number;
  dailyPnlUsd: number;
  marketExposureUsd: Record<string, number>;
  categoryExposureUsd: Record<string, number>;
  openOrderCount: number;
  reconciliationStatus: "ok" | "mismatch" | "unknown";
}

export interface RiskLimits {
  minEdge: number;
  minConfidence: number;
  maxSpread: number;
  maxMarketDataAgeSeconds: number;
  maxModelDisagreement: number;
  maxSingleMarketExposurePct: number;
  maxCategoryExposurePct: number;
  maxTotalExposurePct: number;
  maxOrderSizeUsd: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxOpenOrders: number;
  liquidityParticipationLimitPct: number;
  fractionalKelly: number;
}

export interface TradeIntent {
  clientOrderId?: string;
  exchange?: ExchangeId;
  marketId: string;
  tokenId: string;
  outcome: OutcomeSide;
  side: TradeSide;
  limitPrice: number;
  sizeUsd: number;
  edge: number;
  estimatedProbability: number;
  confidence: number;
  rationale: string[];
}

export interface RiskDecision {
  allowed: boolean;
  reasons: string[];
  intent?: TradeIntent;
  diagnostics: {
    buyEdge: number;
    sellEdge: number;
    selectedEdge: number;
    kellyFraction: number;
    cappedSizeUsd: number;
    drawdownPct: number;
    marketDataStatus: MarketDataStatus;
    executionMultiplier?: number;
    resolutionSpeedMultiplier?: number;
  };
}

export interface ExecutionReceipt {
  localOrderId: string;
  exchangeOrderId?: string;
  status: "paper_accepted" | "exchange_accepted" | "rejected";
  submittedAt: Date;
  rejectionReason?: string;
}
