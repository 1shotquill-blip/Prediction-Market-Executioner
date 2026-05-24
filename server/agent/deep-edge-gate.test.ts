import { describe, expect, it } from "vitest";
import {
  DeepReasoner,
  StaticDeepReasoningProvider,
} from "../intelligence/deep-reasoner";
import type { VectorMemoryStore } from "../memory/vector-retrieval";
import { ProductionDeepEdgeGate } from "./deep-edge-gate";
import type { AgentMarket, EnsembleDecision } from "./types";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will a hidden edge resolve yes?",
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
  category: "politics",
};

const decision: EnsembleDecision = {
  marketId: "market-1",
  outcome: "yes",
  estimatedProbability: 0.56,
  confidence: 0.9,
  estimates: [],
  modelDisagreement: 0.02,
  evidenceSummary: ["hidden catalyst"],
  generatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("deep edge gate", () => {
  it("allows only high-anomaly, high-confidence, high-correction opportunities", async () => {
    const memoryStore: VectorMemoryStore = {
      searchByEmbedding: async () => [
        {
          eventId: "event-1",
          summary: "whale suppression followed by breakout",
          anomalyType: "divergence",
          embedding: [0.9, 0.25, 0.7, 0.8, 0.02, 0.5],
          outcome: "causal",
          similarity: 0.92,
        },
      ],
    };

    const gate = new ProductionDeepEdgeGate({
      memoryStore,
      reasoner: new DeepReasoner(
        new StaticDeepReasoningProvider({
          marketId: "market-1",
          confidence: 0.85,
          fairPriceRange: { low: 0.52, high: 0.68 },
          expectedCorrectionPct: 14,
          contrarianHypothesis: "The crowd is missing a catalyst.",
          steelmanCurrentPrice: "The market says base rates dominate.",
          steelmanRebuttal: "The base-rate view ignores new evidence.",
          identifiedBlindSpot: "Catalyst timing is underweighted.",
          catalyst: {
            description: "A scheduled disclosure reprices the market.",
            expectedAt: new Date("2026-01-05T00:00:00Z"),
            expectedMovePct: 14,
          },
          memoryMatches: [],
        })
      ),
      limits: {
        minAnomalyScore: 0.7,
        minDeepConfidence: 0.8,
        minExpectedCorrectionPct: 10,
        catalystTimeoutMultiplier: 1.5,
      },
    });

    const result = await gate.evaluate(
      market,
      decision,
      {
        peerMarkets: [{ ...market, marketId: "peer", midpoint: 0.62 }],
        priceHistory: [
          {
            observedAt: new Date("2026-01-01T00:00:00Z"),
            referencePrice: 0.44,
          },
          {
            observedAt: new Date("2026-01-01T01:00:00Z"),
            referencePrice: 0.31,
          },
        ],
      },
      new Date("2026-01-01T02:00:00Z")
    );

    expect(result.allowed).toBe(true);
    expect(result.reasoning?.identifiedBlindSpot).toContain("Catalyst");
    expect(result.memoryMatches.length).toBe(1);
  });
});
