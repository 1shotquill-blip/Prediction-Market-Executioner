import { nanoid } from "nanoid";
import { ENV } from "../../_core/env";
import type {
  AgentMarket,
  ExecutionReceipt,
  TradeIntent,
} from "../../agent/types";
import type { OrderLifecycleUpdate } from "../../agent/execution-adapter";
import { mapPolymarketError, PolymarketConfigurationError } from "./errors";
import {
  mapTradeIntentToPolymarketOrder,
  normalizeOpenOrder,
  normalizePostedOrder,
  type PolymarketClientLike,
} from "./types";

export async function placePolymarketOrder(
  client: PolymarketClientLike,
  intent: TradeIntent,
  market: AgentMarket,
  now = new Date()
): Promise<ExecutionReceipt> {
  if (
    !client.createAndPostOrder &&
    (!client.createOrder || !client.postOrder)
  ) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose createAndPostOrder or createOrder/postOrder"
    );
  }

  try {
    const order = mapTradeIntentToPolymarketOrder(intent);
    const rawPosted = client.createAndPostOrder
      ? await client.createAndPostOrder(
          order,
          {
            tickSize: ENV.polymarketDefaultTickSize,
            negRisk: market.negRisk,
          },
          "GTC"
        )
      : await client.postOrder!(
          await client.createOrder!(order, {
            tickSize: ENV.polymarketDefaultTickSize,
            negRisk: market.negRisk,
          }),
          "GTC"
        );
    const posted = normalizePostedOrder(rawPosted);
    if (!posted.orderId || posted.status === "rejected") {
      return {
        localOrderId: `live-${now.getTime()}-${nanoid(8)}`,
        exchangeOrderId: posted.orderId || undefined,
        status: "rejected",
        submittedAt: now,
        rejectionReason: "Polymarket rejected order",
      };
    }

    return {
      localOrderId: `live-${now.getTime()}-${nanoid(8)}`,
      exchangeOrderId: posted.orderId,
      status: "exchange_accepted",
      submittedAt: now,
    };
  } catch (error) {
    throw mapPolymarketError(error);
  }
}

export async function cancelPolymarketOrder(
  client: PolymarketClientLike,
  localOrderId: string,
  exchangeOrderId: string | undefined,
  now = new Date()
): Promise<OrderLifecycleUpdate> {
  if (!exchangeOrderId) {
    throw new PolymarketConfigurationError(
      "Cannot cancel Polymarket order without exchange order id"
    );
  }
  if (!client.cancelOrder && !client.cancel) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose cancel/cancelOrder"
    );
  }

  try {
    if (client.cancelOrder) {
      await client.cancelOrder({ orderID: exchangeOrderId });
    } else {
      await client.cancel!(exchangeOrderId);
    }
    return {
      localOrderId,
      exchangeOrderId,
      status: "cancelled",
      matchedSizeUsd: 0,
      remainingSizeUsd: 0,
      updatedAt: now,
    };
  } catch (error) {
    throw mapPolymarketError(error);
  }
}

export async function syncPolymarketOrder(
  client: PolymarketClientLike,
  localOrderId: string,
  exchangeOrderId: string | undefined,
  now = new Date()
): Promise<OrderLifecycleUpdate> {
  if (!exchangeOrderId) {
    throw new PolymarketConfigurationError(
      "Cannot sync Polymarket order without exchange order id"
    );
  }
  if (!client.getOrder) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose getOrder"
    );
  }

  try {
    const order = normalizeOpenOrder(await client.getOrder(exchangeOrderId));
    return {
      localOrderId,
      exchangeOrderId,
      status: order.status,
      matchedSizeUsd: order.matchedSizeUsd,
      remainingSizeUsd: Math.max(
        0,
        order.originalSizeUsd - order.matchedSizeUsd
      ),
      updatedAt: now,
    };
  } catch (error) {
    throw mapPolymarketError(error);
  }
}
