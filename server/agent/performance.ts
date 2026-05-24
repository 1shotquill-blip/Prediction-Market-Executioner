export interface SettledTrade {
  tradeId: string;
  marketId: string;
  category?: string;
  side: "buy" | "sell";
  entryPrice: number;
  sizeUsd: number;
  estimatedProbability: number;
  confidence: number;
  resolvedProbability: 0 | 1;
  hiddenEdge?: boolean;
  anomalyCausal?: boolean;
}

export interface PerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlUsd: number;
  averageWinUsd: number;
  averageLossUsd: number;
  profitFactor: number;
  brierScore: number;
  hiddenEdgeTrades: number;
  hiddenEdgeHitRate: number;
  hiddenEdgePnlUsd: number;
}

export function computeTradePnlUsd(trade: SettledTrade): number {
  if (trade.side === "buy") {
    const tokenCount = trade.sizeUsd / trade.entryPrice;
    return tokenCount * trade.resolvedProbability - trade.sizeUsd;
  }

  const tokenCount = trade.sizeUsd / trade.entryPrice;
  return trade.sizeUsd - tokenCount * trade.resolvedProbability;
}

export function computeBrierScore(trades: SettledTrade[]): number {
  if (trades.length === 0) return 0;
  const total = trades.reduce((sum, trade) => {
    const error = trade.estimatedProbability - trade.resolvedProbability;
    return sum + error * error;
  }, 0);
  return total / trades.length;
}

export function summarizePerformance(
  trades: SettledTrade[]
): PerformanceSummary {
  const pnls = trades.map(computeTradePnlUsd);
  const wins = pnls.filter(pnl => pnl > 0);
  const losses = pnls.filter(pnl => pnl < 0);
  const realizedPnlUsd = pnls.reduce((sum, pnl) => sum + pnl, 0);
  const grossWins = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
  const hiddenEdgeTrades = trades.filter(trade => trade.hiddenEdge);
  const hiddenEdgeWins = hiddenEdgeTrades.filter(
    trade => computeTradePnlUsd(trade) > 0
  );
  const hiddenEdgePnlUsd = hiddenEdgeTrades.reduce(
    (sum, trade) => sum + computeTradePnlUsd(trade),
    0
  );

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    realizedPnlUsd,
    averageWinUsd: wins.length > 0 ? grossWins / wins.length : 0,
    averageLossUsd: losses.length > 0 ? grossLosses / losses.length : 0,
    profitFactor:
      grossLosses > 0
        ? grossWins / grossLosses
        : grossWins > 0
          ? Number.POSITIVE_INFINITY
          : 0,
    brierScore: computeBrierScore(trades),
    hiddenEdgeTrades: hiddenEdgeTrades.length,
    hiddenEdgeHitRate:
      hiddenEdgeTrades.length > 0
        ? hiddenEdgeWins.length / hiddenEdgeTrades.length
        : 0,
    hiddenEdgePnlUsd,
  };
}
