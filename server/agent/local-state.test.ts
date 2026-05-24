import { describe, expect, it } from "vitest";
import { mapDbOrderToLocalOrder } from "./local-state";
import type { Order } from "../../drizzle/schema";

describe("local portfolio state", () => {
  it("maps DB pending orders into reconciliation local order state", () => {
    const mapped = mapDbOrderToLocalOrder({
      id: 1,
      nonce: "nonce-1",
      exchangeOrderId: "exchange-1",
      marketId: "market-1",
      tokenId: "token-1",
      side: "buy",
      price: "0.50",
      size: "20",
      matchedSize: "0",
      status: "pending",
      lifecycleState: "ACCEPTED_BY_CLOB",
      edgeAtPlacement: "0.10",
      confidenceAtPlacement: "0.80",
      rejectionReason: null,
      placedAt: new Date(),
      acceptedAt: new Date(),
      filledAt: null,
      lastSyncedAt: new Date(),
      cancelledAt: null,
      expiresAt: null,
    } satisfies Order);

    expect(mapped).toMatchObject({
      localOrderId: "nonce-1",
      marketId: "market-1",
      tokenId: "token-1",
      side: "buy",
      price: 0.5,
      sizeUsd: 10,
      matchedSizeUsd: 0,
      status: "pending",
    });
  });
});
