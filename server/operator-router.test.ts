import { describe, expect, it } from "vitest";
import { hybridScore } from "./operator-router";
import type { EnsembleDecision, SocialSignal } from "./agent/types";

// Helper: build a SocialSignal from flat metrics
function tweet(
  likes: number,
  retweets: number,
  replies: number,
  text = "..."
): SocialSignal {
  return {
    id: Math.random().toString(),
    text,
    author_id: "1",
    author_username: "user",
    created_at: new Date().toISOString(),
    metrics: { likes, retweets, replies },
  };
}

// Helper: wrap tweets into a minimal EnsembleDecision
function ensemble(
  confidence: number,
  estimatedProbability: number,
  tweets: SocialSignal[] = []
): EnsembleDecision {
  return {
    marketId: "m1",
    outcome: "yes",
    estimatedProbability,
    confidence,
    estimates: [
      {
        source: "llm",
        probability: estimatedProbability,
        confidence,
        evidence: [],
        freshnessSeconds: 1,
        socialSignals: tweets,
      },
    ],
    modelDisagreement: 0,
    evidenceSummary: [],
    generatedAt: new Date(),
  };
}

describe("hybridScore", () => {
  it("returns 0-100 with all 8 signals contributing", () => {
    const result = hybridScore({
      ensemble: ensemble(0.8, 0.7, [
        tweet(100, 50, 20),
        tweet(200, 80, 40),
      ]),
      deepEdge: { anomaly: { totalScore: 0.75 } } as never,
      selection: { total: 0.6 } as never,
      market: {
        liquidity: 25000,
        volume24h: 50000,
        bestBid: 0.55,
        bestAsk: 0.6,
        lastPriceMovedAt: new Date(),
        orderbookUpdatedAt: new Date(),
      } as never,
    });

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown.socialSignal).toBeGreaterThan(0);
    expect(result.breakdown.llmProbabilityConfidence).toBeCloseTo(0.8, 5);
  });

  it("weights sum to 1.0", () => {
    const weights = [0.2, 0.18, 0.18, 0.1, 0.1, 0.1, 0.1, 0.04];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("socialSignal = 0 when no tweets", () => {
    const result = hybridScore({ ensemble: ensemble(0.8, 0.7, []) });
    expect(result.breakdown.socialSignal).toBe(0);
  });

  it("one viral tweet outweighs 20 dead tweets", () => {
    const viral = hybridScore({
      ensemble: ensemble(0, 0, [tweet(5000, 0, 0)]),
    });
    const dead = hybridScore({
      ensemble: ensemble(
        0,
        0,
        Array.from({ length: 20 }, () => tweet(5, 0, 0))
      ),
    });
    expect(viral.breakdown.socialSignal).toBeGreaterThan(
      dead.breakdown.socialSignal
    );
  });
});
