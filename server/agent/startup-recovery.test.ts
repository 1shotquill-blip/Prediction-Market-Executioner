import { describe, expect, it, vi, beforeEach } from "vitest";
import { recoverOpenOrders } from "./startup-recovery";

const updateOrderStatus = vi.fn(async () => undefined);
const updateOrderSyncState = vi.fn(async () => undefined);
const getOpenOrders = vi.fn();

vi.mock("../db", () => ({
  getOpenOrders: (...args: unknown[]) => getOpenOrders(...args),
  updateOrderStatus: (...args: unknown[]) => updateOrderStatus(...args),
  updateOrderSyncState: (...args: unknown[]) => updateOrderSyncState(...args),
}));

describe("startup recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rehydrates tracked live orders and clears stale ones", async () => {
    getOpenOrders.mockResolvedValue([
      {
        nonce: "stale-1",
        exchangeOrderId: "ex-stale",
        marketId: "market-1",
        tokenId: "token-1",
        side: "buy",
        price: "0.50",
        size: "10",
        matchedSize: "0",
        status: "pending",
        placedAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        nonce: "live-1",
        exchangeOrderId: "ex-live",
        marketId: "market-2",
        tokenId: "token-2",
        side: "sell",
        price: "0.40",
        size: "20",
        matchedSize: "0",
        status: "pending",
        placedAt: new Date("2026-01-01T00:02:40Z"),
      },
    ]);

    const adapter = {
      trackExternalOrder: vi.fn(),
      async sync() {
        return {
          localOrderId: "live-1",
          exchangeOrderId: "ex-live",
          status: "accepted",
          matchedSizeUsd: 0,
          remainingSizeUsd: 8,
          updatedAt: new Date("2026-01-01T00:03:00Z"),
        } as const;
      },
      async cancel() {
        return {
          localOrderId: "stale-1",
          exchangeOrderId: "ex-stale",
          status: "cancelled",
          matchedSizeUsd: 0,
          remainingSizeUsd: 0,
          updatedAt: new Date("2026-01-01T00:03:00Z"),
        } as const;
      },
    };

    const result = await recoverOpenOrders(
      adapter,
      new Date("2026-01-01T00:03:00Z"),
      30_000
    );

    expect(result.status).toBe("ok");
    expect(adapter.trackExternalOrder).toHaveBeenCalledWith(
      "live-1",
      "ex-live",
      expect.objectContaining({ marketId: "market-2" }),
      "market-2"
    );
    expect(updateOrderStatus).toHaveBeenCalledWith("stale-1", "cancelled");
    expect(updateOrderSyncState).toHaveBeenCalled();
  });

  it("fails closed when open orders are missing exchange ids", async () => {
    getOpenOrders.mockResolvedValue([
      {
        nonce: "bad-1",
        exchangeOrderId: null,
        marketId: "market-3",
        tokenId: "token-3",
        side: "buy",
        price: "0.55",
        size: "12",
        matchedSize: "0",
        status: "pending",
        placedAt: new Date("2026-01-01T00:00:45Z"),
      },
    ]);

    const adapter = {
      trackExternalOrder: vi.fn(),
      async sync() {
        throw new Error("should not be called");
      },
      async cancel() {
        throw new Error("should not be called");
      },
    };

    const result = await recoverOpenOrders(
      adapter,
      new Date("2026-01-01T00:01:00Z"),
      30_000
    );

    expect(result.status).toBe("mismatch");
    expect(result.issues[0]?.code).toBe("MISSING_EXCHANGE_ORDER_ID");
  });
});
