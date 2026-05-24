import { describe, expect, it } from "vitest";
import { generateBacktestReport } from "./reporter";
import type { BacktestRunResult } from "./engine";

describe("backtesting reporter", () => {
  it("summarizes drawdown, return, and performance from a run result", () => {
    const result: BacktestRunResult = {
      framesProcessed: 2,
      audits: [],
      trades: [
        {
          tradeId: "trade-1",
          marketId: "m1",
          category: "politics",
          side: "buy",
          entryPrice: 0.5,
          sizeUsd: 100,
          estimatedProbability: 0.7,
          confidence: 0.9,
          resolvedProbability: 1,
          hiddenEdge: true,
          anomalyCausal: true,
        },
      ],
      equityCurve: [
        {
          timestamp: new Date("2026-01-01T00:00:00Z"),
          balanceUsd: 1000,
          peakBalanceUsd: 1000,
          openExposureUsd: 0,
          drawdownPct: 0,
        },
        {
          timestamp: new Date("2026-01-01T01:00:00Z"),
          balanceUsd: 950,
          peakBalanceUsd: 1000,
          openExposureUsd: 0,
          drawdownPct: 5,
        },
        {
          timestamp: new Date("2026-01-01T02:00:00Z"),
          balanceUsd: 1100,
          peakBalanceUsd: 1100,
          openExposureUsd: 0,
          drawdownPct: 0,
        },
      ],
      performance: {
        trades: 1,
        wins: 1,
        losses: 0,
        winRate: 1,
        realizedPnlUsd: 100,
        averageWinUsd: 100,
        averageLossUsd: 0,
        profitFactor: Number.POSITIVE_INFINITY,
        brierScore: 0.09,
        hiddenEdgeTrades: 1,
        hiddenEdgeHitRate: 1,
        hiddenEdgePnlUsd: 100,
      },
      finalBankrollUsd: 1100,
      openExposureUsd: 0,
      unresolvedTradeCount: 0,
    };

    const report = generateBacktestReport(result);
    expect(report.summary.trades).toBe(1);
    expect(report.finalBankrollUsd).toBe(1100);
    expect(report.totalReturnPct).toBeGreaterThan(0);
    expect(report.maxDrawdownPct).toBeGreaterThan(0);
    expect(report.sharpeRatio).toBeGreaterThan(0);
  });
});
