import { describe, expect, it } from "vitest";
import { BacktestingEngine } from "./engine";
import { RuleBasedIntelligenceEngine } from "../agent/intelligence";
import { StaticDeepEdgeGate } from "../agent/deep-edge-gate";
import { scanMarketAnomalies } from "../intelligence/anomaly-scanner";
import type { AgentMarket, EnsembleDecision } from "../agent/types";

const market: AgentMarket = {
  marketId: "backtest-market",
  question: "Will the test resolve yes?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.48,
  bestAsk: 0.5,
  spread: 0.02,
  midpoint: 0.49,
  volume24h: 250_000,
  liquidity: 25_000,
  expiresAt: new Date("2026-02-01T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-01-01T03:00:00Z"),
  category: "politics",
};

const decision: EnsembleDecision = {
  marketId: market.marketId,
  outcome: "yes",
  estimatedProbability: 0.68,
  confidence: 0.9,
  estimates: [],
  modelDisagreement: 0.02,
  evidenceSummary: ["pricing gap"],
  generatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("backtesting engine", () => {
  it("replays a historical frame and settles a trade", async () => {
    const anomaly = scanMarketAnomalies(
      market,
      decision,
      {
        peerMarkets: [
          {
            ...market,
            marketId: "peer-market",
            bestBid: 0.62,
            bestAsk: 0.64,
            midpoint: 0.63,
          },
        ],
        priceHistory: [
          {
            observedAt: new Date("2026-01-01T00:00:00Z"),
            referencePrice: 0.4,
          },
          {
            observedAt: new Date("2026-01-01T02:00:00Z"),
            referencePrice: 0.33,
          },
        ],
      },
      new Date("2026-01-01T03:00:00Z")
    );

    const engine = new BacktestingEngine({
      initialBankrollUsd: 1_000,
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: market.marketId,
          probability: 0.68,
          confidence: 0.9,
          evidence: ["pricing gap"],
        },
      ]),
      deepEdgeGate: new StaticDeepEdgeGate({
        allowed: true,
        anomaly,
        reasoning: {
          marketId: market.marketId,
          confidence: 0.9,
          fairPriceRange: { low: 0.6, high: 0.75 },
          expectedCorrectionPct: 12,
          contrarianHypothesis: "The crowd is missing the price gap.",
          steelmanCurrentPrice: "The market is efficient.",
          steelmanRebuttal: "Fresh evidence points the other way.",
          identifiedBlindSpot: "Short-term repricing is underweighted.",
          catalyst: {
            description: "A scheduled announcement reprices the market.",
            expectedAt: new Date("2026-01-02T00:00:00Z"),
            expectedMovePct: 12,
          },
          memoryMatches: [],
          generatedAt: new Date("2026-01-01T03:00:00Z"),
        },
        memoryMatches: [],
      }),
      maxOrdersPerTick: 1,
      persistAudits: false,
    });

    const result = await engine.run([
      {
        timestamp: new Date("2026-01-01T03:00:00Z"),
        markets: [market],
        resolvedOutcomes: { [market.marketId]: 1 },
      },
    ]);

    expect(result.framesProcessed).toBe(1);
    expect(
      result.audits.some(audit => audit.action === "paper_order_submitted")
    ).toBe(true);
    expect(result.equityCurve).toHaveLength(1);
  });
});
