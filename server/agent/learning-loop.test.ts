import { describe, expect, it } from "vitest";
import { deriveLearningSignals, learnFromSettledTrades } from "./learning-loop";

describe("learning loop", () => {
  it("derives hidden-edge and calibration signals from settled trades", () => {
    const signals = deriveLearningSignals([
      {
        tradeId: "t1",
        marketId: "m1",
        category: "politics",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.7,
        confidence: 0.9,
        resolvedProbability: 1,
        hiddenEdge: true,
      },
      {
        tradeId: "t2",
        marketId: "m2",
        category: "politics",
        side: "buy",
        entryPrice: 0.5,
        sizeUsd: 100,
        estimatedProbability: 0.4,
        confidence: 0.7,
        resolvedProbability: 0,
        hiddenEdge: true,
      },
      {
        tradeId: "t3",
        marketId: "m3",
        category: "sports",
        side: "sell",
        entryPrice: 0.6,
        sizeUsd: 100,
        estimatedProbability: 0.55,
        confidence: 0.8,
        resolvedProbability: 0,
      },
    ]);

    expect(signals.performance.trades).toBe(3);
    expect(signals.performance.hiddenEdgeTrades).toBe(2);
    expect(signals.hiddenEdgeHitRate).toBe(0.5);
    expect(signals.categorySignals).toHaveLength(2);
    expect(signals.recommendedEdgeThreshold).toBeGreaterThan(0.03);
    expect(signals.learningProfile.brierScore).toBeGreaterThan(0);
  });

  it("can run as a no-op persistence step when asked not to persist", async () => {
    const result = await learnFromSettledTrades([], { persist: false });
    expect(result.performance.trades).toBe(0);
    expect(result.recommendedKellyFraction).toBeGreaterThan(0);
  });
});
