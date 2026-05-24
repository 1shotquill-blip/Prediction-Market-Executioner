import { describe, expect, it } from "vitest";
import {
  computeExecutionMicrostructureProfile,
  applyExecutionMicrostructure,
} from "./execution-microstructure";
import type { AgentMarket, TradeIntent } from "./types";

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
  topOfBookDepthBid: 1_500,
  topOfBookDepthAsk: 1_800,
  expiresAt: new Date("2026-01-02T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
};

const intent: TradeIntent = {
  marketId: "market-1",
  tokenId: "yes",
  outcome: "yes",
  side: "buy",
  limitPrice: 0.5,
  sizeUsd: 100,
  edge: 0.08,
  estimatedProbability: 0.58,
  confidence: 0.86,
  rationale: ["test"],
};

describe("execution microstructure", () => {
  it("reduces sizing in thin or stale markets", () => {
    const healthy = computeExecutionMicrostructureProfile(market);
    const thin = computeExecutionMicrostructureProfile({
      ...market,
      topOfBookDepthBid: 100,
      topOfBookDepthAsk: 120,
      spread: 0.08,
      midpoint: 0.45,
    });

    expect(healthy.sizeMultiplier).toBeGreaterThan(thin.sizeMultiplier);
    expect(healthy.sizeMultiplier).toBeLessThanOrEqual(1);
    expect(thin.sizeMultiplier).toBeGreaterThanOrEqual(0.25);
  });

  it("applies the execution multiplier to trade size", () => {
    const adjusted = applyExecutionMicrostructure(intent, {
      ...market,
      topOfBookDepthBid: 100,
      topOfBookDepthAsk: 100,
    });

    expect(adjusted.sizeUsd).toBeLessThan(intent.sizeUsd);
  });
});
