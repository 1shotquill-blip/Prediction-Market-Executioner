import { describe, expect, it, vi } from "vitest";
import type { OrderLifecycleUpdate } from "./execution-adapter";
import type { ExecutionReceipt, TradeIntent } from "./types";

vi.mock("../db", () => ({
  insertOrder: vi.fn(),
  markOrderAccepted: vi.fn(),
  updateOrderStatus: vi.fn(),
  updateOrderSyncState: vi.fn(),
}));

const intent: TradeIntent = {
  marketId: "market-1",
  tokenId: "yes-token",
  outcome: "yes",
  side: "buy",
  limitPrice: 0.5,
  sizeUsd: 100,
  edge: 0.1,
  estimatedProbability: 0.6,
  confidence: 0.8,
  rationale: ["test"],
};

describe("order persistence", () => {
  it("persists accepted paper orders with lifecycle fields", async () => {
    const db = await import("../db");
    const { persistPaperOrderIntent } = await import("./order-persistence");
    const receipt: ExecutionReceipt = {
      localOrderId: "paper-1",
      exchangeOrderId: "paper-exchange-1",
      status: "paper_accepted",
      submittedAt: new Date("2026-01-01T00:00:00Z"),
    };

    await persistPaperOrderIntent(intent, receipt);

    expect(db.insertOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        nonce: "paper-1",
        exchangeOrderId: "paper-exchange-1",
        status: "pending",
        lifecycleState: "ACCEPTED_BY_CLOB",
        size: "200",
      })
    );
  });

  it("persists partial fill updates as matched token size", async () => {
    const db = await import("../db");
    const { persistLifecycleUpdate } = await import("./order-persistence");
    const update: OrderLifecycleUpdate = {
      localOrderId: "paper-1",
      exchangeOrderId: "paper-exchange-1",
      status: "partially_filled",
      matchedSizeUsd: 25,
      remainingSizeUsd: 75,
      updatedAt: new Date(),
    };

    await persistLifecycleUpdate(update, 0.5);

    expect(db.updateOrderSyncState).toHaveBeenCalledWith("paper-1", {
      matchedSize: "50",
      status: "partially_filled",
      lifecycleState: "PARTIALLY_FILLED",
    });
  });
});
