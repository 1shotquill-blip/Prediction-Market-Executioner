import {
  insertOrder,
  markOrderAccepted,
  updateOrderStatus,
  updateOrderSyncState,
} from "../db";
import type { InsertOrder } from "../../drizzle/schema";
import type { OrderLifecycleUpdate } from "./execution-adapter";
import type { ExecutionReceipt, TradeIntent } from "./types";

export async function persistPreExecutionOrderIntent(
  intent: TradeIntent,
  localOrderId: string,
  placedAt = new Date()
): Promise<void> {
  const order: InsertOrder = {
    nonce: localOrderId,
    marketId: intent.marketId,
    tokenId: intent.tokenId,
    side: intent.side,
    price: intent.limitPrice.toString(),
    size: (intent.sizeUsd / intent.limitPrice).toString(),
    matchedSize: "0",
    status: "pending",
    lifecycleState: "INTENT_CREATED",
    edgeAtPlacement: intent.edge.toString(),
    confidenceAtPlacement: intent.confidence.toString(),
    placedAt,
    lastSyncedAt: placedAt,
  };

  await insertOrder(order);
}

export async function persistOrderIntent(
  intent: TradeIntent,
  receipt: ExecutionReceipt
): Promise<void> {
  const accepted =
    receipt.status === "paper_accepted" ||
    receipt.status === "exchange_accepted";
  if (!accepted || !receipt.exchangeOrderId) {
    // Only attempt to update state if this is a known DB entry (exchange_accepted
    // orders haven't been inserted yet, so skip the update for true rejections).
    if (receipt.status === "rejected") {
      await updateOrderSyncState(receipt.localOrderId, {
        status: "rejected",
        lifecycleState: "REJECTED",
        rejectionReason: receipt.rejectionReason ?? "Order rejected",
      }).catch(() => {});
    }
    return;
  }

  const order: InsertOrder = {
    nonce: receipt.localOrderId,
    exchangeOrderId: receipt.exchangeOrderId,
    marketId: intent.marketId,
    tokenId: intent.tokenId,
    side: intent.side,
    price: intent.limitPrice.toString(),
    size: (intent.sizeUsd / intent.limitPrice).toString(),
    matchedSize: "0",
    status: "pending",
    lifecycleState: "ACCEPTED_BY_CLOB",
    edgeAtPlacement: intent.edge.toString(),
    confidenceAtPlacement: intent.confidence.toString(),
    placedAt: receipt.submittedAt,
    acceptedAt: receipt.submittedAt,
    lastSyncedAt: receipt.submittedAt,
  };

  await insertOrder(order);
}

export async function persistAcceptedOrderReceipt(
  receipt: ExecutionReceipt
): Promise<void> {
  const accepted =
    receipt.status === "paper_accepted" ||
    receipt.status === "exchange_accepted";
  if (!accepted || !receipt.exchangeOrderId) return;
  await markOrderAccepted(receipt.localOrderId, receipt.exchangeOrderId);
}

/** @deprecated Use persistOrderIntent — handles both paper and live receipts. */
export const persistPaperOrderIntent = persistOrderIntent;

export async function persistLifecycleUpdate(
  update: OrderLifecycleUpdate,
  limitPrice: number
): Promise<void> {
  const matchedTokenSize =
    limitPrice > 0 ? update.matchedSizeUsd / limitPrice : 0;

  if (update.status === "filled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "filled",
      lifecycleState: "FILLED",
    });
    return;
  }

  if (update.status === "partially_filled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "partially_filled",
      lifecycleState: "PARTIALLY_FILLED",
    });
    return;
  }

  if (update.status === "expired") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "expired",
      lifecycleState: "EXPIRED",
    });
    return;
  }

  if (update.status === "cancel_requested") {
    await updateOrderStatus(update.localOrderId, "cancel_requested");
    return;
  }

  if (update.status === "cancelled") {
    await updateOrderSyncState(update.localOrderId, {
      matchedSize: matchedTokenSize.toString(),
      status: "cancelled",
      lifecycleState: "CANCEL_CONFIRMED",
    });
    return;
  }

  if (update.status === "rejected") {
    await updateOrderSyncState(update.localOrderId, {
      status: "rejected",
      lifecycleState: "REJECTED",
      rejectionReason: update.reason ?? "Order rejected",
    });
  }
}
