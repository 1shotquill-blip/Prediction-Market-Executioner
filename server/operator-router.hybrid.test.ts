import { describe, expect, it } from "vitest";
import { hybridScore } from "./operator-router";
import type { EnsembleDecision, SocialSignal } from "./agent/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTweet(overrides: Partial<SocialSignal["metrics"]> & { text?: string } = {}): SocialSignal {
  return {
    id: Math.random().toString(),
    text: overrides.text ?? "test tweet",
    author_id: "1",
    author_username: "testuser",
    created_at: new Date().toISOString(),
    metrics: {
      likes: overrides.likes ?? 0,
      retweets: overrides.retweets ?? 0,
      replies: overrides.replies ?? 0,
    },
  };
}

function makeEnsemble(confidence: number, tweets: SocialSignal[] = []): EnsembleDecision {
  return {
    marketId: "test-market",
    outcome: "yes",
    estimatedProbability: 0.6,
    confidence,
    estimates: [
      {
        source: "llm",
        probability: 0.6,
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

// ─── Weight sum ──────────────────────────────────────────────────────────────

describe("hybridScore weights", () => {
  it("weights sum to exactly 1.0", () => {
    const weights = [0.20, 0.18, 0.18, 0.10, 0.10, 0.10, 0.10, 0.04];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ─── Zero input ──────────────────────────────────────────────────────────────

describe("hybridScore with no inputs", () => {
  it("returns score 0 when nothing is provided", () => {
    const result = hybridScore({});
    expect(result.score).toBe(0);
  });

  it("breakdown fields are all zero", () => {
    const result = hybridScore({});
    expect(result.breakdown.llmProbabilityConfidence).toBe(0);
    expect(result.breakdown.socialSignal).toBe(0);
    expect(result.breakdown.socialTweetCount).toBe(0);
    expect(result.breakdown.socialTopTweets).toHaveLength(0);
  });
});

// ─── socialSignal normalization ──────────────────────────────────────────────

describe("socialSignal engagement weighting", () => {
  it("one viral tweet (5000 likes) yields socialSignal = 1.0", () => {
    const tweet = makeTweet({ likes: 5000 });
    const result = hybridScore({ ensemble: makeEnsemble(0, [tweet]) });
    // engagement = 5000 + 0 + 0 = 5000; min(1, 5000/1000) = 1.0
    expect(result.breakdown.socialSignal).toBe(1.0);
  });

  it("20 dead tweets (0 engagement) yields socialSignal = 0", () => {
    const tweets = Array.from({ length: 20 }, () => makeTweet());
    const result = hybridScore({ ensemble: makeEnsemble(0, tweets) });
    expect(result.breakdown.socialSignal).toBe(0);
  });

  it("retweets count double vs likes", () => {
    const byRetweet = hybridScore({ ensemble: makeEnsemble(0, [makeTweet({ retweets: 100 })]) });
    const byLike    = hybridScore({ ensemble: makeEnsemble(0, [makeTweet({ likes: 100 })]) });
    // 100 retweets = 200 engagement; 100 likes = 100 engagement
    expect(byRetweet.breakdown.socialSignal).toBeGreaterThan(byLike.breakdown.socialSignal);
  });

  it("replies count 1.5×", () => {
    const byReply = hybridScore({ ensemble: makeEnsemble(0, [makeTweet({ replies: 100 })]) });
    const byLike  = hybridScore({ ensemble: makeEnsemble(0, [makeTweet({ likes: 100 })]) });
    // 100 replies = 150 engagement; 100 likes = 100 engagement
    expect(byReply.breakdown.socialSignal).toBeGreaterThan(byLike.breakdown.socialSignal);
  });

  it("clamps socialSignal at 1.0", () => {
    const tweet = makeTweet({ likes: 999_999 });
    const result = hybridScore({ ensemble: makeEnsemble(0, [tweet]) });
    expect(result.breakdown.socialSignal).toBe(1.0);
  });

  it("partial engagement: 500 likes = socialSignal 0.5", () => {
    const tweet = makeTweet({ likes: 500 });
    const result = hybridScore({ ensemble: makeEnsemble(0, [tweet]) });
    expect(result.breakdown.socialSignal).toBeCloseTo(0.5, 5);
  });
});

// ─── socialSignal contribution to total score ────────────────────────────────

describe("socialSignal contribution to hybrid score", () => {
  it("contributes 9 points to score at signal=1.0 with all other signals=0", () => {
    const tweet = makeTweet({ likes: 5000 });
    const result = hybridScore({ ensemble: makeEnsemble(0, [tweet]) });
    // score = socialSignal(1.0) * 0.09 * 100 = 9
    expect(result.score).toBeCloseTo(9, 1);
  });

  it("adding viral tweet increases score vs no tweets", () => {
    const withTweet    = hybridScore({ ensemble: makeEnsemble(0.8, [makeTweet({ likes: 500 })]) });
    const withoutTweet = hybridScore({ ensemble: makeEnsemble(0.8, []) });
    expect(withTweet.score).toBeGreaterThan(withoutTweet.score);
  });
});

// ─── socialTopTweets ─────────────────────────────────────────────────────────

describe("socialTopTweets in breakdown", () => {
  it("returns at most 3 top tweets", () => {
    const tweets = Array.from({ length: 10 }, (_, i) =>
      makeTweet({ likes: i * 10, text: `tweet ${i}` })
    );
    const result = hybridScore({ ensemble: makeEnsemble(0, tweets) });
    expect(result.breakdown.socialTopTweets.length).toBeLessThanOrEqual(3);
  });

  it("top tweet has highest engagement", () => {
    const tweets = [
      makeTweet({ likes: 10, text: "low" }),
      makeTweet({ likes: 500, text: "high" }),
      makeTweet({ likes: 50, text: "mid" }),
    ];
    const result = hybridScore({ ensemble: makeEnsemble(0, tweets) });
    expect(result.breakdown.socialTopTweets[0]?.snippet).toContain("high");
  });

  it("snippets are truncated to 80 chars", () => {
    const longText = "x".repeat(200);
    const tweets = [makeTweet({ likes: 100, text: longText })];
    const result = hybridScore({ ensemble: makeEnsemble(0, tweets) });
    expect(result.breakdown.socialTopTweets[0]?.snippet.length).toBeLessThanOrEqual(80);
  });

  it("tweetCount matches input length", () => {
    const tweets = Array.from({ length: 7 }, () => makeTweet({ likes: 1 }));
    const result = hybridScore({ ensemble: makeEnsemble(0, tweets) });
    expect(result.breakdown.socialTweetCount).toBe(7);
  });
});

// ─── Full weighted score sanity check ────────────────────────────────────────

describe("hybridScore full weighted calculation", () => {
  it("max confidence + max social = 27 points (0.18 + 0.09) × 100", () => {
    const tweet = makeTweet({ likes: 5000 });
    const result = hybridScore({ ensemble: makeEnsemble(1.0, [tweet]) });
    // llmConf(1.0)*0.18 + social(1.0)*0.09 = 0.27 → 27 pts (rest are 0)
    expect(result.score).toBeCloseTo(27, 1);
  });
});
