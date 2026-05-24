import { describe, expect, it } from "vitest";
import {
  buildPortfolioSnapshot,
  mapClobOpenOrder,
  reconcilePortfolio,
} from "./reconciliation";
import type {
  ExchangePortfolioState,
  LocalPortfolioState,
} from "./reconciliation";

const local: LocalPortfolioState = {
  bankrollUsd: 1000,
  peakBankrollUsd: 1100,
  dailyPnlUsd: -5,
  orders: [
    {
      localOrderId: "local-1",
      exchangeOrderId: "exchange-1",
      marketId: "market-1",
      tokenId: "token-1",
      side: "buy",
      price: 0.5,
      sizeUsd: 100,
      matchedSizeUsd: 20,
      status: "partially_filled",
      category: "politics",
    },
  ],
};

const exchange: ExchangePortfolioState = {
  cashUsd: 900,
  openOrders: [
    {
      exchangeOrderId: "exchange-1",
      marketId: "market-1",
      tokenId: "token-1",
      side: "buy",
      price: 0.5,
      originalSizeUsd: 100,
      matchedSizeUsd: 20,
      status: "OPEN",
    },
  ],
  positions: [
    {
      marketId: "market-1",
      tokenId: "token-1",
      sizeUsd: 20,
      currentValueUsd: 22,
      category: "politics",
    },
  ],
};

describe("portfolio reconciliation", () => {
  it("returns ok when local and exchange open order state match", () => {
    const result = reconcilePortfolio(local, exchange);

    expect(result.status).toBe("ok");
    expect(result.issues).toHaveLength(0);
    expect(result.portfolio.reconciliationStatus).toBe("ok");
  });

  it("detects local open orders missing from exchange", () => {
    const result = reconcilePortfolio(local, { ...exchange, openOrders: [] });

    expect(result.status).toBe("mismatch");
    expect(result.issues.map(issue => issue.code)).toContain(
      "LOCAL_PENDING_ORDER_NOT_ON_EXCHANGE"
    );
  });

  it("detects exchange open orders missing locally", () => {
    const result = reconcilePortfolio({ ...local, orders: [] }, exchange);

    expect(result.status).toBe("mismatch");
    expect(result.issues.map(issue => issue.code)).toContain(
      "EXCHANGE_ORDER_NOT_LOCAL"
    );
  });

  it("detects price and size mismatches", () => {
    const result = reconcilePortfolio(local, {
      ...exchange,
      openOrders: [
        { ...exchange.openOrders[0]!, price: 0.55, originalSizeUsd: 120 },
      ],
    });

    expect(result.status).toBe("mismatch");
    expect(result.issues.map(issue => issue.code)).toEqual(
      expect.arrayContaining(["ORDER_PRICE_MISMATCH", "ORDER_SIZE_MISMATCH"])
    );
  });

  it("builds portfolio exposure from exchange positions and open orders", () => {
    const snapshot = buildPortfolioSnapshot(local, exchange, "ok");

    expect(snapshot.bankrollUsd).toBe(922);
    expect(snapshot.peakBankrollUsd).toBe(1100);
    expect(snapshot.openExposureUsd).toBe(102);
    expect(snapshot.marketExposureUsd["market-1"]).toBe(102);
    expect(snapshot.categoryExposureUsd.politics).toBe(22);
  });

  it("maps CLOB open order fields into exchange state", () => {
    expect(
      mapClobOpenOrder({
        id: "0xabc",
        market: "0xcondition",
        asset_id: "token",
        side: "BUY",
        price: "0.42",
        original_size: "50",
        size_matched: "10",
        status: "OPEN",
      })
    ).toMatchObject({
      exchangeOrderId: "0xabc",
      marketId: "0xcondition",
      tokenId: "token",
      side: "buy",
      price: 0.42,
      originalSizeUsd: 50,
      matchedSizeUsd: 10,
    });
  });
});
