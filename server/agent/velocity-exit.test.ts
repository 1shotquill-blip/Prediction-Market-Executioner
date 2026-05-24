import { describe, expect, it } from "vitest";
import {
  buildVelocityExitCandidate,
  computeAverageEntryPrice,
} from "./velocity-exit";
import type { AgentMarket } from "./types";

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will the event happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.85,
  bestAsk: 0.87,
  spread: 0.02,
  midpoint: 0.86,
  volume24h: 50_000,
  liquidity: 10_000,
  expiresAt: new Date(Date.now() + 12 * 3_600_000),
  orderbookUpdatedAt: new Date(),
  category: "crypto",
};

describe("velocity exit", () => {
  it("tracks moving-average entry price through buys and partial sells", () => {
    const entryPrice = computeAverageEntryPrice([
      { side: "buy", price: 0.6, size: 10 },
      { side: "buy", price: 0.7, size: 10 },
      { side: "sell", price: 0.8, size: 5 },
    ]);

    expect(entryPrice).not.toBeNull();
    expect(entryPrice ?? 0).toBeGreaterThan(0.62);
    expect(entryPrice ?? 0).toBeLessThan(0.66);
  });

  it("builds a sell intent when the market has repriced enough to take profit", () => {
    const candidate = buildVelocityExitCandidate({
      market,
      position: {
        marketId: "market-1",
        tokenId: "yes-token",
        currentValueUsd: 85,
        sizeUsd: 100,
      },
      trades: [{ side: "buy", price: 0.6, size: 100 / 0.6 }],
      now: new Date(),
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.intent.side).toBe("sell");
    expect(candidate?.intent.limitPrice).toBe(0.85);
    expect(candidate?.intent.sizeUsd).toBe(85);
  });

  it("skips positions that have not moved enough", () => {
    const candidate = buildVelocityExitCandidate({
      market: {
        ...market,
        bestBid: 0.68,
        bestAsk: 0.7,
      },
      position: {
        marketId: "market-1",
        tokenId: "yes-token",
        currentValueUsd: 68,
        sizeUsd: 100,
      },
      trades: [{ side: "buy", price: 0.64, size: 100 / 0.64 }],
      now: new Date(),
    });

    expect(candidate).toBeNull();
  });
});
