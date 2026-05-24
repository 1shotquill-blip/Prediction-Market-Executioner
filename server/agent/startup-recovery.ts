import { ENV } from "../_core/env";
import { getOpenOrders, updateOrderStatus, updateOrderSyncState } from "../db";
import type { AgentMarket, TradeIntent } from "./types";
import type { ExecutionAdapter } from "./execution-adapter";

export interface StartupRecoveryIssue {
  severity: "warning" | "critical";
  code:
    | "MISSING_EXCHANGE_ORDER_ID"
    | "STALE_OPEN_ORDER_CANCELLED"
    | "SYNC_FAILED"
    | "CANCEL_FAILED";
  message: string;
  localOrderId: string;
  exchangeOrderId?: string;
}

export interface StartupRecoveryResult {
  status: "ok" | "mismatch";
  recoveredOrders: number;
  cancelledOrders: number;
  issues: StartupRecoveryIssue[];
}

function buildRecoveryMarket(order: {
  marketId: string;
  tokenId: string;
  side: "buy" | "sell";
  price: string | number;
  placedAt: Date;
}): AgentMarket {
  const price = Number(order.price);
  return {
    marketId: order.marketId,
    question: order.marketId,
    yesTokenId: order.tokenId,
    noTokenId: order.tokenId,
    bestBid: order.side === "sell" ? price : Math.max(0, price - 0.01),
    bestAsk: order.side === "buy" ? price : Math.min(1, price + 0.01),
    spread: 0.01,
    midpoint: price,
    volume24h: 0,
    liquidity: 0,
    expiresAt: new Date(order.placedAt.getTime() + 86_400_000),
    orderbookUpdatedAt: order.placedAt,
  };
}

function buildRecoveryIntent(order: {
  marketId: string;
  tokenId: string;
  side: "buy" | "sell";
  price: string | number;
  size: string | number;
}): TradeIntent {
  const price = Number(order.price);
  const size = Number(order.size);
  return {
    marketId: order.marketId,
    tokenId: order.tokenId,
    outcome: "yes",
    side: order.side,
    limitPrice: price,
    sizeUsd: size * price,
    edge: 0,
    estimatedProbability: price,
    confidence: 0,
    rationale: ["startup recovery"],
  };
}

export async function recoverOpenOrders(
  adapter: ExecutionAdapter & {
    trackExternalOrder?: (
      localOrderId: string,
      exchangeOrderId: string,
      intent: TradeIntent,
      marketId?: string
    ) => void;
  },
  now = new Date(),
  orderTtlMs = ENV.orderTtlMs
): Promise<StartupRecoveryResult> {
  const openOrders = await getOpenOrders();
  const issues: StartupRecoveryIssue[] = [];
  let recoveredOrders = 0;
  let cancelledOrders = 0;

  for (const order of openOrders) {
    const ageMs = now.getTime() - new Date(order.placedAt).getTime();
    const isStale = ageMs > orderTtlMs;

    if (isStale && order.nonce) {
      try {
        await adapter.cancel(order.nonce, now);
        await updateOrderStatus(order.nonce, "cancelled");
        cancelledOrders += 1;
        issues.push({
          severity: "warning",
          code: "STALE_OPEN_ORDER_CANCELLED",
          message: `Cancelled stale open order ${order.nonce} during startup recovery`,
          localOrderId: order.nonce,
          exchangeOrderId: order.exchangeOrderId ?? undefined,
        });
      } catch (error) {
        issues.push({
          severity: "critical",
          code: "CANCEL_FAILED",
          message: `Failed to cancel stale order ${order.nonce}: ${String(error)}`,
          localOrderId: order.nonce,
          exchangeOrderId: order.exchangeOrderId ?? undefined,
        });
      }
      continue;
    }

    if (!order.exchangeOrderId) {
      issues.push({
        severity: "critical",
        code: "MISSING_EXCHANGE_ORDER_ID",
        message: `Open order ${order.nonce} has no exchange order id`,
        localOrderId: order.nonce,
      });
      await updateOrderSyncState(order.nonce, {
        status: "rejected",
        lifecycleState: "RECONCILIATION_MISMATCH",
        rejectionReason: "Missing exchange order id during startup recovery",
      });
      continue;
    }

    const intent = buildRecoveryIntent(order);
    if (typeof adapter.trackExternalOrder === "function") {
      adapter.trackExternalOrder(
        order.nonce,
        order.exchangeOrderId,
        intent,
        order.marketId
      );
    }

    try {
      const update = await adapter.sync(
        order.nonce,
        buildRecoveryMarket(order),
        now
      );
      recoveredOrders += 1;
      await updateOrderSyncState(order.nonce, {
        matchedSize:
          update.matchedSizeUsd > 0
            ? (update.matchedSizeUsd / Number(order.price)).toString()
            : "0",
        status:
          update.status === "filled"
            ? "filled"
            : update.status === "partially_filled"
              ? "partially_filled"
              : update.status === "cancelled"
                ? "cancelled"
                : update.status === "expired"
                  ? "expired"
                  : "pending",
        lifecycleState:
          update.status === "filled"
            ? "FILLED"
            : update.status === "partially_filled"
              ? "PARTIALLY_FILLED"
              : update.status === "cancelled"
                ? "CANCEL_CONFIRMED"
                : update.status === "expired"
                  ? "EXPIRED"
                  : "ACCEPTED_BY_CLOB",
      });
    } catch (error) {
      issues.push({
        severity: "critical",
        code: "SYNC_FAILED",
        message: `Failed to sync open order ${order.nonce}: ${String(error)}`,
        localOrderId: order.nonce,
        exchangeOrderId: order.exchangeOrderId ?? undefined,
      });
    }
  }

  return {
    status: issues.some(issue => issue.severity === "critical")
      ? "mismatch"
      : "ok",
    recoveredOrders,
    cancelledOrders,
    issues,
  };
}
