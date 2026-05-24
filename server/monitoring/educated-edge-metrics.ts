export interface EducatedEdgeTrade {
  tradeId: string;
  openedAt: Date;
  hiddenEdge: boolean;
  pnlUsd: number;
  anomalyCausal?: boolean;
  resolvedAt?: Date;
}

export interface EducatedEdgeSummary {
  invisibleEdgeRatio: number;
  hiddenEdgeHitRate: number;
  hiddenEdgePnlUsd: number;
  totalPnlUsd: number;
}

export class EducatedEdgeMetricsTracker {
  private readonly trades = new Map<string, EducatedEdgeTrade>();

  recordTrade(trade: EducatedEdgeTrade): void {
    this.trades.set(trade.tradeId, trade);
  }

  markResolution(
    tradeId: string,
    result: { pnlUsd: number; anomalyCausal: boolean; resolvedAt?: Date }
  ): void {
    const trade = this.trades.get(tradeId);
    if (!trade) throw new Error(`Unknown educated-edge trade ${tradeId}`);
    this.trades.set(tradeId, {
      ...trade,
      pnlUsd: result.pnlUsd,
      anomalyCausal: result.anomalyCausal,
      resolvedAt: result.resolvedAt ?? new Date(),
    });
  }

  summarize(now = new Date(), windowDays = 90): EducatedEdgeSummary {
    const cutoff = now.getTime() - windowDays * 86_400_000;
    const trades = Array.from(this.trades.values()).filter(
      trade => trade.openedAt.getTime() >= cutoff
    );
    const hidden = trades.filter(trade => trade.hiddenEdge);
    const hiddenWins = hidden.filter(trade => trade.pnlUsd > 0);
    const totalPnlUsd = trades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
    const hiddenEdgePnlUsd = hidden.reduce(
      (sum, trade) => sum + trade.pnlUsd,
      0
    );

    return {
      invisibleEdgeRatio:
        trades.length === 0 ? 0 : hidden.length / trades.length,
      hiddenEdgeHitRate:
        hidden.length === 0 ? 0 : hiddenWins.length / hidden.length,
      hiddenEdgePnlUsd,
      totalPnlUsd,
    };
  }
}
