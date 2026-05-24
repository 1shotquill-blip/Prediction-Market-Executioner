import { describe, expect, it } from "vitest";
import {
  FAST_PLAY_MAX_EXPIRY_HOURS,
  computeHoursToExpiry,
  scanTradableMarkets,
} from "./market-scanner";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("market scanner", () => {
  it("rejects markets with wide CLOB spreads", async () => {
    const httpClient = {
      fetch: async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/markets")) {
          return jsonResponse([
            {
              id: "wide-market",
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
          bids: [{ price: "0.40", size: "500" }],
          asks: [{ price: "0.50", size: "400" }],
        });
      },
    };

    const result = await scanTradableMarkets({ limit: 10, httpClient });

    expect(result.tradable).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("wide_spread");
  });

  it("hard-gates markets resolving beyond 72 hours", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(
      computeHoursToExpiry(
        {
          marketId: "slow-market",
          question: "Will this happen next month?",
          yesTokenId: "yes-token-2",
          noTokenId: "no-token-2",
          bestBid: 0.4,
          bestAsk: 0.5,
          spread: 0.1,
          midpoint: 0.45,
          volume24h: 25_000,
          liquidity: 1_500,
          expiresAt: new Date("2026-01-10T00:00:00Z"),
          orderbookUpdatedAt: now,
          category: "politics",
        },
        now
      )
    ).toBeGreaterThan(FAST_PLAY_MAX_EXPIRY_HOURS);
  });
});
