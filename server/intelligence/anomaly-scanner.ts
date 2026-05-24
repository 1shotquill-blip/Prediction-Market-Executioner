import { getClobReferencePrice } from "../agent/book-pricing";
import type { AgentMarket, EnsembleDecision } from "../agent/types";

export interface PriceObservation {
  observedAt: Date;
  referencePrice: number;
}

export interface TradePrint {
  price: number;
  sizeUsd: number;
  side: "buy" | "sell";
  observedAt: Date;
}

export interface AnomalyScannerContext {
  peerMarkets?: AgentMarket[];
  priceHistory?: PriceObservation[];
  whaleTrades?: TradePrint[];
}

export interface AnomalyComponentScore {
  score: number;
  reason: string;
}

export interface AnomalyScanResult {
  marketId: string;
  totalScore: number;
  components: {
    crossMarket: AnomalyComponentScore;
    temporal: AnomalyComponentScore;
    divergence: AnomalyComponentScore;
    whale: AnomalyComponentScore;
  };
  anomalyType: string;
  generatedAt: Date;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function scoreDivergence(
  market: AgentMarket,
  decision: EnsembleDecision
): AnomalyComponentScore {
  const referencePrice = getClobReferencePrice(market);
  if (!Number.isFinite(referencePrice)) {
    return { score: 0, reason: "invalid CLOB reference price" };
  }

  const gap = Math.abs(decision.estimatedProbability - referencePrice);
  const score = clamp01(gap / 0.2);
  return {
    score,
    reason: `model-market probability gap ${(gap * 100).toFixed(2)}pp`,
  };
}

function scoreTemporal(
  market: AgentMarket,
  context: AnomalyScannerContext
): AnomalyComponentScore {
  const history = [...(context.priceHistory ?? [])].sort(
    (a, b) => a.observedAt.getTime() - b.observedAt.getTime()
  );
  if (history.length < 2) {
    return { score: 0, reason: "insufficient temporal history" };
  }

  const first = history[0].referencePrice;
  const last = history[history.length - 1].referencePrice;
  const move = Math.abs(last - first);
  const liquidityAdjustedMove =
    move * Math.log10(Math.max(10, market.liquidity));
  return {
    score: clamp01(liquidityAdjustedMove / 0.45),
    reason: `recent midpoint move ${(move * 100).toFixed(2)}pp`,
  };
}

function scoreCrossMarket(
  market: AgentMarket,
  context: AnomalyScannerContext
): AnomalyComponentScore {
  const peers = (context.peerMarkets ?? []).filter(
    peer =>
      peer.marketId !== market.marketId &&
      peer.category &&
      market.category &&
      peer.category === market.category
  );
  if (peers.length === 0) {
    return { score: 0, reason: "no same-category peer markets supplied" };
  }

  const referencePrices = peers
    .map(peer => getClobReferencePrice(peer))
    .filter(Number.isFinite);
  const marketReference = getClobReferencePrice(market);
  if (!Number.isFinite(marketReference) || referencePrices.length === 0) {
    return {
      score: 0,
      reason: "invalid peer or market CLOB reference price",
    };
  }

  const peerAverage =
    referencePrices.reduce((sum, price) => sum + price, 0) /
    referencePrices.length;
  const gap = Math.abs(marketReference - peerAverage);
  return {
    score: clamp01(gap / 0.18),
    reason: `category peer price gap ${(gap * 100).toFixed(2)}pp`,
  };
}

function scoreWhaleBehavior(
  market: AgentMarket,
  decision: EnsembleDecision,
  context: AnomalyScannerContext
): AnomalyComponentScore {
  const largeTrades = (context.whaleTrades ?? []).filter(
    trade => trade.sizeUsd >= Math.max(1_000, market.liquidity * 0.05)
  );

  if (largeTrades.length > 0) {
    const netPressure = largeTrades.reduce(
      (sum, trade) => sum + (trade.side === "buy" ? 1 : -1) * trade.sizeUsd,
      0
    );
    const pressureMagnitude =
      Math.abs(netPressure) / Math.max(1, market.liquidity);
    return {
      score: clamp01(pressureMagnitude),
      reason: `large trade pressure ${netPressure.toFixed(2)} USDC`,
    };
  }

  const referencePrice = getClobReferencePrice(market);
  const gap = Number.isFinite(referencePrice)
    ? Math.abs(decision.estimatedProbability - referencePrice)
    : 0;
  const turnover = market.volume24h / Math.max(1, market.liquidity);
  const suppressionSignal = gap * Math.log10(Math.max(1, turnover + 1));
  return {
    score: clamp01(suppressionSignal / 0.08),
    reason: `turnover/liquidity anomaly ${turnover.toFixed(3)}`,
  };
}

function classifyAnomaly(result: AnomalyScanResult): string {
  const ranked = Object.entries(result.components).sort(
    ([, a], [, b]) => b.score - a.score
  );
  const [top] = ranked;
  return top?.[0] ?? "unknown";
}

export function scanMarketAnomalies(
  market: AgentMarket,
  decision: EnsembleDecision,
  context: AnomalyScannerContext = {},
  now = new Date()
): AnomalyScanResult {
  const components: AnomalyScanResult["components"] = {
    crossMarket: scoreCrossMarket(market, context),
    temporal: scoreTemporal(market, context),
    divergence: scoreDivergence(market, decision),
    whale: scoreWhaleBehavior(market, decision, context),
  };

  const totalScore =
    components.divergence.score * 0.4 +
    components.crossMarket.score * 0.2 +
    components.temporal.score * 0.2 +
    components.whale.score * 0.2;

  const result: AnomalyScanResult = {
    marketId: market.marketId,
    totalScore,
    components,
    anomalyType: "unknown",
    generatedAt: now,
  };
  result.anomalyType = classifyAnomaly(result);
  return result;
}
