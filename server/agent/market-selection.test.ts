import { describe, expect, it } from "vitest";
import {
  computeLiquidityScore,
  computeTimeRemainingScore,
  computeVolumeVelocityScore,
  computeRecencyPenalty,
  computeConsensusDivergenceScore,
  passesLiquidityGate,
  scoreOpportunity,
  MIN_TOP_OF_BOOK_USD,
} from "./market-selection";
import type { AgentMarket, RiskDecision } from "./types";

const NOW = new Date("2026-01-01T00:00:00Z");

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will this happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.5,
  bestAsk: 0.52,
  spread: 0.02,
  midpoint: 0.51,
  volume24h: 48_000,
  volume1h: 4_000,
  liquidity: 25_000,
  topOfBookDepthBid: 1_000,
  topOfBookDepthAsk: 1_200,
  expiresAt: new Date("2026-01-02T12:00:00Z"), // 36h from NOW
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
};

const risk: RiskDecision = {
  allowed: true,
  reasons: [],
  intent: {
    marketId: "market-1",
    tokenId: "yes-token",
    outcome: "yes",
    side: "buy",
    limitPrice: 0.52,
    sizeUsd: 50,
    edge: 0.08,
    estimatedProbability: 0.6,
    confidence: 0.85,
    rationale: ["test"],
  },
  diagnostics: {
    buyEdge: 0.08,
    sellEdge: -0.1,
    selectedEdge: 0.08,
    kellyFraction: 0.01,
    cappedSizeUsd: 50,
    drawdownPct: 0,
    marketDataStatus: "fresh",
  },
};

// ─── Signal 1: Time-to-resolution ───────────────────────────────────────────

describe("computeTimeRemainingScore", () => {
  it("returns 0 for expired markets", () => {
    expect(
      computeTimeRemainingScore(new Date("2025-12-31T00:00:00Z"), NOW)
    ).toBe(0);
  });

  it("ramps up for markets resolving in < 6h", () => {
    expect(
      computeTimeRemainingScore(new Date("2026-01-01T03:00:00Z"), NOW)
    ).toBeCloseTo(0.5);
  });

  it("scores 1 for markets in the 6–72h sweet spot", () => {
    expect(
      computeTimeRemainingScore(new Date("2026-01-02T00:00:00Z"), NOW)
    ).toBe(1); // 24h
    expect(
      computeTimeRemainingScore(new Date("2026-01-03T00:00:00Z"), NOW)
    ).toBe(1); // 48h
    expect(
      computeTimeRemainingScore(new Date("2026-01-04T00:00:00Z"), NOW)
    ).toBe(1); // 72h
  });

  it("decays to 0 between 72h and 7d", () => {
    const score96h = computeTimeRemainingScore(
      new Date("2026-01-05T00:00:00Z"),
      NOW
    ); // 96h
    expect(score96h).toBeGreaterThan(0);
    expect(score96h).toBeLessThan(1);
  });

  it("returns 0 at or beyond 7 days", () => {
    expect(
      computeTimeRemainingScore(new Date("2026-01-08T00:00:00Z"), NOW)
    ).toBe(0);
    expect(
      computeTimeRemainingScore(new Date("2026-02-01T00:00:00Z"), NOW)
    ).toBe(0);
  });
});

// ─── Signal 2: Volume velocity ───────────────────────────────────────────────

describe("computeVolumeVelocityScore", () => {
  it("returns 0.5 when 1h volume is absent", () => {
    expect(computeVolumeVelocityScore(48_000, undefined)).toBe(0.5);
  });

  it("returns high score when volume is accelerating (2x run rate)", () => {
    // 24h avg = 2000/h; 1h = 4000 → 2x → (2-0.25)/(3-0.25) ≈ 0.636
    expect(computeVolumeVelocityScore(48_000, 4_000)).toBeCloseTo(0.636, 2);
  });

  it("returns low score when volume is decelerating (0.3x run rate)", () => {
    // 24h avg = 2000/h; 1h = 600 → 0.3x
    expect(computeVolumeVelocityScore(48_000, 600)).toBeLessThan(0.1);
  });

  it("clamps at 0 and 1", () => {
    // volume1h=0 → velocity=0 → below 0.25 floor → 0
    expect(computeVolumeVelocityScore(48_000, 0)).toBe(0);
    // very high 1h volume → velocity >> 3 → clamped to 1
    expect(computeVolumeVelocityScore(48_000, 1_000_000)).toBe(1);
  });
});

// ─── Signal 3: Recency bias penalty ─────────────────────────────────────────

describe("computeRecencyPenalty", () => {
  it("returns 1 when price moved recently (< 6h)", () => {
    const movedAt = new Date(NOW.getTime() - 2 * 3_600_000);
    expect(computeRecencyPenalty(movedAt, NOW, NOW)).toBe(1);
  });

  it("applies partial penalty between 6–24h", () => {
    const movedAt = new Date(NOW.getTime() - 12 * 3_600_000);
    const penalty = computeRecencyPenalty(movedAt, NOW, NOW);
    expect(penalty).toBeGreaterThan(0.4);
    expect(penalty).toBeLessThan(1);
  });

  it("caps at 0.4 discount after 24+ hours of no movement", () => {
    const movedAt = new Date(NOW.getTime() - 30 * 3_600_000);
    expect(computeRecencyPenalty(movedAt, NOW, NOW)).toBe(0.4);
  });

  it("falls back to orderbookUpdatedAt when lastPriceMovedAt absent", () => {
    const staleOrderbook = new Date(NOW.getTime() - 30 * 3_600_000);
    expect(computeRecencyPenalty(undefined, staleOrderbook, NOW)).toBe(0.4);
  });
});

// ─── Signal 4: Minimum liquidity gate ───────────────────────────────────────

describe("passesLiquidityGate", () => {
  it("passes when both sides have depth >= $500", () => {
    expect(passesLiquidityGate(market)).toBe(true);
  });

  it("fails when bid depth is below $500", () => {
    expect(passesLiquidityGate({ ...market, topOfBookDepthBid: 400 })).toBe(
      false
    );
  });

  it("fails when ask depth is below $500", () => {
    expect(passesLiquidityGate({ ...market, topOfBookDepthAsk: 200 })).toBe(
      false
    );
  });

  it("fails when both sides are zero", () => {
    expect(
      passesLiquidityGate({
        ...market,
        topOfBookDepthBid: 0,
        topOfBookDepthAsk: 0,
      })
    ).toBe(false);
  });

  it(`MIN_TOP_OF_BOOK_USD is $${MIN_TOP_OF_BOOK_USD}`, () => {
    expect(MIN_TOP_OF_BOOK_USD).toBe(500);
  });
});

// ─── Signal 5: Consensus divergence ─────────────────────────────────────────

describe("computeConsensusDivergenceScore", () => {
  it("returns 1 when LLM diverges >= 15% from market", () => {
    expect(computeConsensusDivergenceScore(0.7, 0.5)).toBe(1); // 20% gap
    expect(computeConsensusDivergenceScore(0.35, 0.51)).toBeCloseTo(1); // 16% gap
  });

  it("returns proportional score for smaller gaps", () => {
    // 7.5% gap → 0.5
    expect(computeConsensusDivergenceScore(0.575, 0.5)).toBeCloseTo(0.5, 1);
  });

  it("returns 0 when LLM agrees with market", () => {
    expect(computeConsensusDivergenceScore(0.51, 0.51)).toBe(0);
  });

  it("returns 0 when estimate is absent", () => {
    expect(computeConsensusDivergenceScore(undefined, 0.51)).toBe(0);
  });
});

// ─── Combined scoreOpportunity ───────────────────────────────────────────────

describe("scoreOpportunity", () => {
  it("zeroes total when liquidity gate fails", () => {
    const illiquid = {
      ...market,
      topOfBookDepthBid: 100,
      topOfBookDepthAsk: 100,
    };
    const score = scoreOpportunity(illiquid, risk, undefined, NOW);
    expect(score.total).toBe(0);
    expect(score.passedLiquidityGate).toBe(false);
  });

  it("applies recency penalty to total", () => {
    const stale = {
      ...market,
      orderbookUpdatedAt: new Date(NOW.getTime() - 30 * 3_600_000),
    };
    const fresh = { ...market };
    const staleScore = scoreOpportunity(stale, risk, undefined, NOW);
    const freshScore = scoreOpportunity(fresh, risk, undefined, NOW);
    expect(staleScore.total).toBeLessThan(freshScore.total);
    expect(staleScore.recencyPenalty).toBe(0.4);
  });

  it("boosts score when LLM diverges strongly from market", () => {
    const ensemble = {
      marketId: "market-1",
      outcome: "yes" as const,
      estimatedProbability: 0.7, // 19% above midpoint 0.51
      confidence: 0.85,
      estimates: [],
      modelDisagreement: 0,
      evidenceSummary: [],
      generatedAt: NOW,
    };
    const withDivergence = scoreOpportunity(
      market,
      risk,
      undefined,
      NOW,
      ensemble
    );
    const withoutDivergence = scoreOpportunity(market, risk, undefined, NOW);
    expect(withDivergence.consensusDivergenceScore).toBe(1);
    expect(withDivergence.total).toBeGreaterThan(withoutDivergence.total);
  });

  it("produces valid component scores for a healthy market", () => {
    const score = scoreOpportunity(market, risk, undefined, NOW);
    expect(score.passedLiquidityGate).toBe(true);
    expect(score.recencyPenalty).toBe(1);
    expect(score.total).toBeGreaterThan(0);
    expect(score.timeRemainingScore).toBe(1); // 36h → sweet spot
    expect(score.volumeVelocityScore).toBeGreaterThan(0.6); // 2x run rate ≈ 0.636
  });
});
