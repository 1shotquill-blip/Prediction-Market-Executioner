import { describe, expect, it } from "vitest";
import type { AgentMarket, TradeIntent } from "../../agent/types";
import { ensureTradingAllowances } from "./allowances";
import { KillswitchBlocked } from "./errors";
import { PolymarketAdapter } from "./index";
import { PolymarketKillswitch } from "./killswitch";
import { fetchPolymarketExchangeState } from "./positions";
import type {
  PolymarketClientLike,
  PolymarketSignedOrderRequest,
} from "./types";

const market: AgentMarket = {
  marketId: "market-1",
  conditionId: "condition-1",
  question: "Will this resolve yes?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.49,
  bestAsk: 0.52,
  spread: 0.03,
  midpoint: 0.505,
  volume24h: 50_000,
  liquidity: 12_000,
  expiresAt: new Date("2026-07-01T00:00:00Z"),
  orderbookUpdatedAt: new Date("2026-05-01T00:00:00Z"),
  negRisk: false,
};

const intent: TradeIntent = {
  marketId: "market-1",
  tokenId: "yes-token",
  outcome: "yes",
  side: "buy",
  limitPrice: 0.52,
  sizeUsd: 104,
  edge: 0.08,
  estimatedProbability: 0.6,
  confidence: 0.85,
  rationale: ["test"],
};

function armedKillswitch(): PolymarketKillswitch {
  return new PolymarketKillswitch({
    armed: true,
    maxNotionalUsd: 500,
    maxOrdersPerMinute: 10,
    perMarketCapUsd: 500,
    maxSpreadBps: 1_000,
  });
}

describe("PolymarketAdapter", () => {
  it("places, syncs, and cancels through the injected CLOB v2 client", async () => {
    const postedOrders: PolymarketSignedOrderRequest[] = [];
    const cancelled: unknown[] = [];
    const client: PolymarketClientLike = {
      async createAndPostOrder(order) {
        postedOrders.push(order);
        return { orderID: "exchange-1", status: "live" };
      },
      async getOrder(orderId) {
        return {
          id: orderId,
          market: "market-1",
          asset_id: "yes-token",
          side: "BUY",
          price: 0.52,
          original_size: 200,
          size_matched: 50,
        };
      },
      async cancelOrder(payload) {
        cancelled.push(payload);
        return { success: true };
      },
    };

    const adapter = new PolymarketAdapter(client, {
      killswitch: armedKillswitch(),
      requireAllowance: false,
    });
    const receipt = await adapter.place(
      intent,
      market,
      new Date("2026-05-01T00:00:00Z")
    );
    const synced = await adapter.sync(receipt.localOrderId, market);
    const cancelledUpdate = await adapter.cancel(receipt.localOrderId);

    expect(receipt.status).toBe("exchange_accepted");
    expect(receipt.exchangeOrderId).toBe("exchange-1");
    expect(postedOrders[0]).toMatchObject({
      tokenID: "yes-token",
      price: 0.52,
      side: "BUY",
      size: 200,
    });
    expect(synced.status).toBe("partially_filled");
    expect(synced.matchedSizeUsd).toBe(26);
    expect(cancelledUpdate.status).toBe("cancelled");
    expect(cancelled).toEqual([{ orderID: "exchange-1" }]);
  });

  it("fails closed when the live kill switch is not armed", async () => {
    const adapter = new PolymarketAdapter(
      {
        async createAndPostOrder() {
          return { orderID: "must-not-place", status: "live" };
        },
      },
      {
        killswitch: new PolymarketKillswitch({
          armed: false,
          maxNotionalUsd: 500,
          maxOrdersPerMinute: 10,
          perMarketCapUsd: 500,
          maxSpreadBps: 1_000,
        }),
        requireAllowance: false,
      }
    );

    await expect(adapter.place(intent, market)).rejects.toBeInstanceOf(
      KillswitchBlocked
    );
  });

  it("blocks live orders that exceed per-market cap or spread limits", async () => {
    const adapter = new PolymarketAdapter(
      {
        async createAndPostOrder() {
          return { orderID: "must-not-place", status: "live" };
        },
      },
      {
        killswitch: new PolymarketKillswitch({
          armed: true,
          maxNotionalUsd: 500,
          maxOrdersPerMinute: 10,
          perMarketCapUsd: 50,
          maxSpreadBps: 100,
        }),
        requireAllowance: false,
      }
    );

    await expect(adapter.place(intent, market)).rejects.toThrow(
      "per-market cap"
    );
    await expect(
      adapter.place({ ...intent, sizeUsd: 25 }, market)
    ).rejects.toThrow("spread");
  });

  it("normalizes live exchange state for reconciliation", async () => {
    const client: PolymarketClientLike = {
      async getBalance() {
        return { available: "123.45" };
      },
      async getPositions() {
        return [
          {
            marketId: "market-1",
            tokenId: "yes-token",
            outcome: "Yes",
            size: "10",
            valueUsd: "7.5",
          },
        ];
      },
      async getOpenOrders() {
        return [
          {
            id: "order-1",
            market: "market-1",
            asset_id: "yes-token",
            side: "SELL",
            price: "0.75",
            original_size: "8",
            size_matched: "2",
          },
        ];
      },
    };

    const state = await fetchPolymarketExchangeState(client);

    expect(state.cashUsd).toBe(123.45);
    expect(state.positions[0]).toMatchObject({
      marketId: "market-1",
      tokenId: "yes-token",
      currentValueUsd: 7.5,
    });
    expect(state.openOrders[0]).toMatchObject({
      exchangeOrderId: "order-1",
      side: "sell",
      originalSizeUsd: 6,
      matchedSizeUsd: 1.5,
    });
  });

  it("uses the SDK's allowance parameter shape", async () => {
    const allowanceCalls: unknown[] = [];
    let collateralAllowance = 0;
    let conditionalAllowance = 0;
    const client: PolymarketClientLike = {
      async getBalanceAllowance(params) {
        allowanceCalls.push(["get", params]);
        const value = params as { asset_type?: string; token_id?: string };
        const allowance =
          value.asset_type === "CONDITIONAL"
            ? conditionalAllowance
            : collateralAllowance;
        return { allowance: String(allowance) };
      },
      async updateBalanceAllowance(params) {
        allowanceCalls.push(["update", params]);
        const value = params as { asset_type?: string; token_id?: string };
        if (value.asset_type === "CONDITIONAL") {
          conditionalAllowance = 100;
        } else {
          collateralAllowance = 100;
        }
        return { success: true };
      },
    };

    await ensureTradingAllowances(client, 25, "yes-token");

    expect(allowanceCalls).toEqual([
      ["get", { asset_type: "COLLATERAL" }],
      ["update", { asset_type: "COLLATERAL" }],
      ["get", { asset_type: "COLLATERAL" }],
      ["get", { asset_type: "CONDITIONAL", token_id: "yes-token" }],
      ["update", { asset_type: "CONDITIONAL", token_id: "yes-token" }],
      ["get", { asset_type: "CONDITIONAL", token_id: "yes-token" }],
    ]);
  });
});
