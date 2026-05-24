import { nanoid } from "nanoid";
import { ENV } from "../../_core/env";
import type { OrderLifecycleUpdate } from "../../agent/execution-adapter";
import type {
  AgentMarket,
  ExecutionReceipt,
  TradeIntent,
} from "../../agent/types";
import { KalshiClient } from "./client";

interface KalshiOrderResponse {
  order?: Record<string, unknown>;
  order_id?: string;
  id?: string;
  status?: string;
}

function decimalToCents(value: number): number {
  return Math.round(Math.max(0.01, Math.min(0.99, value)) * 100);
}

function orderIdFrom(body: KalshiOrderResponse): string {
  return String(
    body.order?.order_id ?? body.order?.id ?? body.order_id ?? body.id ?? ""
  );
}

function statusFrom(raw: unknown): OrderLifecycleUpdate["status"] {
  const status = String(raw ?? "").toLowerCase();
  if (status.includes("fill")) return "filled";
  if (status.includes("cancel")) return "cancelled";
  if (status.includes("reject")) return "rejected";
  return "accepted";
}

export async function placeKalshiLimitOrder(
  client: KalshiClient,
  intent: TradeIntent,
  _market: AgentMarket,
  now = new Date()
): Promise<ExecutionReceipt> {
  const localOrderId =
    intent.clientOrderId ?? `kalshi-live-${now.getTime()}-${nanoid(8)}`;
  const count = Math.max(
    1,
    Math.floor(intent.sizeUsd / Math.max(intent.limitPrice, 0.01))
  );
  const body = await client.request<KalshiOrderResponse>("/portfolio/orders", {
    method: "POST",
    body: {
      ticker: intent.marketId,
      client_order_id: localOrderId,
      side: intent.side === "buy" ? "yes" : "no",
      action: "buy",
      type: "limit",
      post_only: ENV.kalshiPostOnly,
      count,
      yes_price:
        intent.outcome === "yes"
          ? decimalToCents(intent.limitPrice)
          : undefined,
      no_price:
        intent.outcome === "no" ? decimalToCents(intent.limitPrice) : undefined,
    },
  });
  const orderId = orderIdFrom(body);
  if (!orderId) {
    return {
      localOrderId,
      status: "rejected",
      submittedAt: now,
      rejectionReason: "Kalshi did not return an order id",
    };
  }
  return {
    localOrderId,
    exchangeOrderId: orderId,
    status: "exchange_accepted",
    submittedAt: now,
  };
}

export async function cancelKalshiOrder(
  client: KalshiClient,
  localOrderId: string,
  exchangeOrderId: string | undefined,
  now = new Date()
): Promise<OrderLifecycleUpdate> {
  if (!exchangeOrderId)
    throw new Error("Cannot cancel Kalshi order without id");
  await client.request(
    `/portfolio/orders/${encodeURIComponent(exchangeOrderId)}`,
    {
      method: "DELETE",
    }
  );
  return {
    localOrderId,
    exchangeOrderId,
    status: "cancelled",
    matchedSizeUsd: 0,
    remainingSizeUsd: 0,
    updatedAt: now,
  };
}

export async function getKalshiOrderStatus(
  client: KalshiClient,
  localOrderId: string,
  exchangeOrderId: string | undefined,
  now = new Date()
): Promise<OrderLifecycleUpdate> {
  if (!exchangeOrderId) throw new Error("Cannot sync Kalshi order without id");
  const body = await client.request<KalshiOrderResponse>(
    `/portfolio/orders/${encodeURIComponent(exchangeOrderId)}`
  );
  const order = (body.order ?? body) as Record<string, unknown>;
  const originalCount = Number(order.count ?? 0);
  const remainingCount = Number(order.remaining_count ?? 0);
  const price = Number(order.yes_price ?? order.no_price ?? 0) / 100;
  const matchedSizeUsd = Math.max(0, (originalCount - remainingCount) * price);
  return {
    localOrderId,
    exchangeOrderId,
    status: statusFrom(order.status ?? body.status),
    matchedSizeUsd,
    remainingSizeUsd: Math.max(0, remainingCount * price),
    updatedAt: now,
  };
}
