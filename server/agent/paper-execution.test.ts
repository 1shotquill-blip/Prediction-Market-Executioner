import { describe, expect, it } from "vitest";
import { computeExecutionMicrostructureProfile } from "./execution-microstructure";
import { isIntentImmediatelyMarketable } from "./execution-adapter";
import { PaperExecutionAdapter } from "./paper-execution";
import type { AgentMarket, TradeIntent } from "./types";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will this happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.5,
  bestAsk: 0.52,
  spread: 0.02,
  midpoint: 0.51,
  volume24h: 50000,
  liquidity: 10000,
  expiresAt: new Date(Date.now() + 86_400_000),
  orderbookUpdatedAt: new Date(),
};

const buyIntent: TradeIntent = {
  marketId: "market-1",
  tokenId: "yes-token",
  outcome: "yes",
  side: "buy",
  limitPrice: 0.52,
  sizeUsd: 100,
  edge: 0.08,
  estimatedProbability: 0.6,
  confidence: 0.8,
  rationale: ["test"],
};

describe("paper execution adapter", () => {
  it("detects marketable buy and sell intents using executable bid/ask", () => {
    expect(isIntentImmediatelyMarketable(buyIntent, market)).toBe(true);
    expect(
      isIntentImmediatelyMarketable({ ...buyIntent, limitPrice: 0.51 }, market)
    ).toBe(false);
    expect(
      isIntentImmediatelyMarketable(
        { ...buyIntent, side: "sell", limitPrice: 0.5 },
        market
      )
    ).toBe(true);
    expect(
      isIntentImmediatelyMarketable(
        { ...buyIntent, side: "sell", limitPrice: 0.51 },
        market
      )
    ).toBe(false);
  });

  it("accepts and fully fills marketable paper orders when visible liquidity is enough", async () => {
    const adapter = new PaperExecutionAdapter();
    const receipt = await adapter.place(
      buyIntent,
      market,
      new Date("2026-01-01T00:00:00Z")
    );
    const update = await adapter.sync(
      receipt.localOrderId,
      market,
      new Date("2026-01-01T00:00:01Z")
    );

    expect(receipt.status).toBe("paper_accepted");
    expect(update.status).toBe("filled");
    expect(update.matchedSizeUsd).toBe(100);
    expect(update.remainingSizeUsd).toBe(0);
  });

  it("partially fills when liquidity cap is smaller than order size", async () => {
    const adapter = new PaperExecutionAdapter({
      orderTtlMs: 30_000,
      partialFillRatio: 1,
    });
    const thinMarket = { ...market, liquidity: 1000 };
    const receipt = await adapter.place(
      { ...buyIntent, sizeUsd: 100 },
      thinMarket
    );
    const update = await adapter.sync(receipt.localOrderId, thinMarket);
    const profile = computeExecutionMicrostructureProfile(thinMarket);

    expect(update.status).toBe("partially_filled");
    expect(update.matchedSizeUsd).toBeCloseTo(20 * profile.sizeMultiplier, 6);
    expect(update.remainingSizeUsd).toBeCloseTo(
      100 - 20 * profile.sizeMultiplier,
      6
    );
  });

  it("expires non-marketable paper orders after ttl", async () => {
    const adapter = new PaperExecutionAdapter({
      orderTtlMs: 1000,
      partialFillRatio: 1,
    });
    const now = new Date("2026-01-01T00:00:00Z");
    const receipt = await adapter.place(
      { ...buyIntent, limitPrice: 0.51 },
      market,
      now
    );
    const update = await adapter.sync(
      receipt.localOrderId,
      market,
      new Date("2026-01-01T00:00:02Z")
    );

    expect(update.status).toBe("expired");
    expect(update.reason).toContain("expired");
  });

  it("cancels accepted paper orders", async () => {
    const adapter = new PaperExecutionAdapter();
    const receipt = await adapter.place(
      { ...buyIntent, limitPrice: 0.51 },
      market
    );
    const update = await adapter.cancel(receipt.localOrderId);

    expect(update.status).toBe("cancelled");
  });
});
