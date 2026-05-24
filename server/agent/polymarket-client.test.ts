import { describe, expect, it } from "vitest";
import {
  computeVisibleLiquidityUsd,
  normalizeAgentMarket,
  parseJsonArray,
  scanPolymarketCandidates,
} from "./polymarket-client";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("Polymarket market data client", () => {
  it("parses token arrays from Gamma string fields", () => {
    expect(parseJsonArray('["yes","no"]')).toEqual(["yes", "no"]);
    expect(parseJsonArray("yes,no")).toEqual(["yes", "no"]);
  });

  it("normalizes Gamma and CLOB book data into executable YES bid/ask", () => {
    const market = normalizeAgentMarket(
      {
        id: "market-1",
        question: "Will this resolve yes?",
        clobTokenIds: '["yes-token","no-token"]',
        active: true,
        closed: false,
        enableOrderBook: true,
        volume24hr: "50000",
        liquidity: "1000",
        endDate: "2030-01-01T00:00:00Z",
      },
      {
        market: "condition-1",
        timestamp: "1893456000",
        bids: [
          { price: "0.50", size: "200" },
          { price: "0.51", size: "100" },
        ],
        asks: [
          { price: "0.55", size: "100" },
          { price: "0.54", size: "200" },
        ],
        neg_risk: false,
      }
    );

    expect(market?.yesTokenId).toBe("yes-token");
    expect(market?.noTokenId).toBe("no-token");
    expect(market?.bestBid).toBe(0.51);
    expect(market?.bestAsk).toBe(0.54);
    expect(market?.spread).toBeCloseTo(0.03);
  });

  it("computes visible orderbook liquidity from bid and ask levels", () => {
    const liquidity = computeVisibleLiquidityUsd({
      bids: [{ price: "0.40", size: "100" }],
      asks: [{ price: "0.60", size: "50" }],
    });

    expect(liquidity).toBe(70);
  });

  it("scans Gamma markets and enriches them with CLOB books", async () => {
    const calls: string[] = [];
    const httpClient = {
      fetch: async (input: string | URL) => {
        const url = String(input);
        calls.push(url);

        if (url.includes("/markets")) {
          return jsonResponse([
            {
              id: "market-1",
              question: "Will this happen?",
              clobTokenIds: '["yes-token","no-token"]',
              active: true,
              closed: false,
              enableOrderBook: true,
              volume24hr: "25000",
              liquidity: "1500",
              endDate: "2030-01-01T00:00:00Z",
            },
          ]);
        }

        return jsonResponse({
          market: "condition-1",
          timestamp: String(Math.floor(Date.now() / 1000)),
          bids: [{ price: "0.49", size: "500" }],
          asks: [{ price: "0.51", size: "400" }],
          tick_size: "0.01",
        });
      },
    };

    const markets = await scanPolymarketCandidates({
      limit: 10,
      minVolume24h: 1000,
      httpClient,
    });

    expect(markets).toHaveLength(1);
    expect(markets[0]?.bestBid).toBe(0.49);
    expect(markets[0]?.bestAsk).toBe(0.51);
    expect(calls.some(url => url.includes("/book?token_id=yes-token"))).toBe(
      true
    );
  });
});
