import { describe, expect, it } from "vitest";
import { computeTradePnlUsd, summarizePerformance } from "./performance";

describe("performance metrics", () => {
  it("computes binary token PnL for winning and losing buys", () => {
    expect(
      computeTradePnlUsd({
        tradeId: "t1",
        marketId: "m1",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.7,
        confidence: 0.8,
        resolvedProbability: 1,
      })
    ).toBe(100);

    expect(
      computeTradePnlUsd({
        tradeId: "t2",
        marketId: "m1",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.7,
        confidence: 0.8,
        resolvedProbability: 0,
      })
    ).toBe(-100);
  });

  it("summarizes win rate, profit factor, and calibration error", () => {
    const summary = summarizePerformance([
      {
        tradeId: "t1",
        marketId: "m1",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.8,
        confidence: 0.9,
        resolvedProbability: 1,
      },
      {
        tradeId: "t2",
        marketId: "m2",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.8,
        confidence: 0.9,
        resolvedProbability: 0,
      },
    ]);

    expect(summary.trades).toBe(2);
    expect(summary.wins).toBe(1);
    expect(summary.losses).toBe(1);
    expect(summary.winRate).toBe(0.5);
    expect(summary.profitFactor).toBe(1);
    expect(summary.brierScore).toBeCloseTo(0.34);
    expect(summary.hiddenEdgeTrades).toBe(0);
    expect(summary.hiddenEdgeHitRate).toBe(0);
  });
});
