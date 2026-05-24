import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getLatestEquitySnapshot: vi.fn(async () => ({
    balance: "1000",
    peakBalance: "1200",
  })),
  getEquityHistory: vi.fn(async () => [
    { balance: "900", timestamp: new Date("2026-01-01T00:00:00Z") },
    { balance: "1000", timestamp: new Date("2026-01-01T12:00:00Z") },
  ]),
  getOpenOrders: vi.fn(async () => [
    {
      nonce: "order-1",
      exchangeOrderId: "ex-1",
      marketId: "market-1",
      tokenId: "token-1",
      side: "buy",
      price: "0.5",
      size: "100",
      matchedSize: "25",
      status: "pending",
    },
  ]),
  getMarketByMarketId: vi.fn(async () => ({
    category: "politics",
  })),
}));

import { getExchangePortfolioState } from "./portfolio-state";

describe("portfolio state", () => {
  it("builds a local snapshot when not running live trading", async () => {
    const originalMode = process.env.EXECUTION_MODE;
    process.env.EXECUTION_MODE = "paper";
    try {
      const state = await getExchangePortfolioState(
        new Date("2026-01-02T00:00:00Z")
      );

      expect(state.exchange).toBeNull();
      expect(state.snapshot.bankrollUsd).toBe(1000);
      expect(state.snapshot.peakBankrollUsd).toBe(1200);
      expect(state.snapshot.dailyPnlUsd).toBe(100);
      expect(state.snapshot.openExposureUsd).toBe(75);
      expect(state.snapshot.categoryExposureUsd.politics).toBe(75);
    } finally {
      process.env.EXECUTION_MODE = originalMode;
    }
  });
});
