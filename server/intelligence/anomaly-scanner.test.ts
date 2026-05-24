import { describe, expect, it } from "vitest";
import { scanMarketAnomalies } from "./anomaly-scanner";
import type { AgentMarket, EnsembleDecision } from "../agent/types";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will the underdog win?",
  yesTokenId: "yes",
  noTokenId: "no",
  bestBid: 0.3,
  bestAsk: 0.32,
  spread: 0.02,
  midpoint: 0.31,
  volume24h: 250_000,
  liquidity: 20_000,
  expiresAt: new Date("2026-02-01T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  category: "sports",
};

const decision: EnsembleDecision = {
  marketId: "market-1",
  outcome: "yes",
  estimatedProbability: 0.55,
  confidence: 0.88,
  estimates: [],
  modelDisagreement: 0.04,
  evidenceSummary: ["pricing gap"],
  generatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("anomaly scanner", () => {
  it("combines divergence, temporal, peer, and whale signals into a bounded score", () => {
    const result = scanMarketAnomalies(
      market,
      decision,
      {
        peerMarkets: [
          {
            ...market,
            marketId: "peer-1",
            midpoint: 0.62,
            bestBid: 0.61,
            bestAsk: 0.63,
          },
        ],
        priceHistory: [
          {
            observedAt: new Date("2026-01-01T00:00:00Z"),
            referencePrice: 0.42,
          },
          {
            observedAt: new Date("2026-01-01T02:00:00Z"),
            referencePrice: 0.31,
          },
        ],
        whaleTrades: [
          {
            price: 0.31,
            sizeUsd: 2_500,
            side: "sell",
            observedAt: new Date("2026-01-01T01:00:00Z"),
          },
        ],
      },
      new Date("2026-01-01T03:00:00Z")
    );

    expect(result.totalScore).toBeGreaterThanOrEqual(0.7);
    expect(result.totalScore).toBeLessThanOrEqual(1);
    expect(result.components.divergence.reason).toContain("gap");
    expect(result.anomalyType).not.toBe("unknown");
  });
});
