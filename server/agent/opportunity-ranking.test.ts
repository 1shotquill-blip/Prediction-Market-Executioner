import { describe, expect, it } from "vitest";
import { rankOpportunity } from "./opportunity-ranking";
import type { AgentMarket, EnsembleDecision, RiskDecision } from "./types";
import type { DeepEdgeDecision } from "./deep-edge-gate";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will this happen?",
  yesTokenId: "yes",
  noTokenId: "no",
  bestBid: 0.48,
  bestAsk: 0.5,
  spread: 0.02,
  midpoint: 0.49,
  volume24h: 50_000,
  liquidity: 20_000,
  expiresAt: new Date("2026-01-02T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
};

const ensemble: EnsembleDecision = {
  marketId: "market-1",
  outcome: "yes",
  estimatedProbability: 0.61,
  confidence: 0.84,
  estimates: [],
  modelDisagreement: 0.03,
  evidenceSummary: ["strong signal"],
  generatedAt: new Date(),
};

const risk: RiskDecision = {
  allowed: true,
  reasons: [],
  intent: {
    marketId: "market-1",
    tokenId: "yes",
    outcome: "yes",
    side: "buy",
    limitPrice: 0.5,
    sizeUsd: 100,
    edge: 0.11,
    estimatedProbability: 0.61,
    confidence: 0.84,
    rationale: ["strong signal"],
  },
  diagnostics: {
    buyEdge: 0.11,
    sellEdge: -0.13,
    selectedEdge: 0.11,
    kellyFraction: 0.01,
    cappedSizeUsd: 100,
    drawdownPct: 0,
    marketDataStatus: "fresh",
    executionMultiplier: 1,
  },
};

const deepEdge: DeepEdgeDecision = {
  allowed: true,
  reasons: [],
  anomaly: {
    marketId: "market-1",
    totalScore: 0.82,
    anomalyType: "divergence",
    generatedAt: new Date(),
    components: {
      crossMarket: { score: 0.7, reason: "peer dislocation" },
      temporal: { score: 0.6, reason: "temporal dislocation" },
      divergence: { score: 0.95, reason: "large model-market gap" },
      whale: { score: 0.5, reason: "pressure anomaly" },
    },
  },
  reasoning: {
    marketId: "market-1",
    confidence: 0.85,
    fairPriceRange: { low: 0.58, high: 0.7 },
    expectedCorrectionPct: 12,
    contrarianHypothesis: "Crowd is missing the catalyst.",
    steelmanCurrentPrice: "Base rates look tempting.",
    steelmanRebuttal: "Base rates omit the new evidence.",
    identifiedBlindSpot: "Timing is underweighted.",
    catalyst: {
      description: "Scheduled disclosure reprices the market.",
      expectedAt: new Date("2026-01-02T00:00:00Z"),
      expectedMovePct: 12,
    },
    memoryMatches: [],
    generatedAt: new Date(),
  },
  memoryMatches: [
    {
      eventId: "event-1",
      summary: "whale suppression followed by breakout",
      embedding: [0.9, 0.25, 0.7, 0.8, 0.02, 0.5],
      anomalyType: "divergence",
      outcome: "causal",
      similarity: 0.9,
    },
  ],
};

describe("opportunity ranking", () => {
  it("ranks a high-conviction anomaly above a weaker analogue", () => {
    const strong = rankOpportunity({
      market,
      ensemble,
      risk,
      deepEdge,
      memoryMatches: deepEdge.memoryMatches,
      learningProfile: {
        categoryPrior: 0.62,
        hiddenEdgeHitRate: 0.24,
        brierScore: 0.12,
      },
    });
    const weak = rankOpportunity({
      market,
      ensemble,
      risk: {
        ...risk,
        intent: { ...risk.intent!, sizeUsd: 30, edge: 0.04 },
      },
      deepEdge: {
        ...deepEdge,
        anomaly: { ...deepEdge.anomaly, totalScore: 0.3 },
        reasoning: { ...deepEdge.reasoning!, confidence: 0.5 },
      },
      memoryMatches: [],
    });

    expect(strong.rank).toBeGreaterThan(weak.rank);
    expect(strong.expectedValueUsd).toBeGreaterThan(0);
    expect(strong.nonObviousnessScore).toBeGreaterThan(
      weak.nonObviousnessScore
    );
  });
});
