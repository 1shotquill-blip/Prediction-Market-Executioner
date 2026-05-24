import { nanoid } from "nanoid";
import type { AgentMarket, ExecutionReceipt, TradeIntent } from "./types";
import {
  DEFAULT_PAPER_EXECUTION_OPTIONS,
  computePaperFillSizeUsd,
  type ExecutionAdapter,
  type OrderLifecycleUpdate,
  type PaperExecutionOptions,
  type SimulatedOrderState,
} from "./execution-adapter";

export class PaperExecutionAdapter implements ExecutionAdapter {
  private readonly orders = new Map<string, SimulatedOrderState>();
  private readonly options: PaperExecutionOptions;

  constructor(
    options: PaperExecutionOptions = DEFAULT_PAPER_EXECUTION_OPTIONS
  ) {
    this.options = options;
  }

  async place(
    intent: TradeIntent,
    _market: AgentMarket,
    now = new Date()
  ): Promise<ExecutionReceipt> {
    if (
      intent.sizeUsd <= 0 ||
      intent.limitPrice <= 0 ||
      intent.limitPrice >= 1
    ) {
      return {
        localOrderId: "",
        status: "rejected",
        submittedAt: now,
        rejectionReason: "Invalid paper order size or price",
      };
    }

    const localOrderId =
      intent.clientOrderId ?? `paper-${now.getTime()}-${nanoid(8)}`;
    const exchangeOrderId = `paper-exchange-${localOrderId}`;
    this.orders.set(localOrderId, {
      localOrderId,
      exchangeOrderId,
      intent,
      originalSizeUsd: intent.sizeUsd,
      matchedSizeUsd: 0,
      acceptedAt: now,
      lastSyncedAt: now,
      expiresAt: new Date(now.getTime() + this.options.orderTtlMs),
      status: "accepted",
    });

    return {
      localOrderId,
      exchangeOrderId,
      status: "paper_accepted",
      submittedAt: now,
    };
  }

  async sync(
    localOrderId: string,
    market: AgentMarket,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    const order = this.getOrderOrThrow(localOrderId);
    if (
      order.status === "cancelled" ||
      order.status === "expired" ||
      order.status === "filled"
    ) {
      return this.toUpdate(order, now);
    }

    if (
      now >= order.expiresAt &&
      order.matchedSizeUsd < order.originalSizeUsd
    ) {
      order.status = "expired";
      order.lastSyncedAt = now;
      return this.toUpdate(order, now, "Paper order expired before full fill");
    }

    const remainingSizeUsd = order.originalSizeUsd - order.matchedSizeUsd;
    const fillSizeUsd = computePaperFillSizeUsd(
      order.intent,
      market,
      remainingSizeUsd,
      this.options
    );
    order.matchedSizeUsd += fillSizeUsd;
    order.lastSyncedAt = now;

    if (order.matchedSizeUsd >= order.originalSizeUsd) {
      order.matchedSizeUsd = order.originalSizeUsd;
      order.status = "filled";
    } else if (order.matchedSizeUsd > 0) {
      order.status = "partially_filled";
    }

    return this.toUpdate(order, now);
  }

  async cancel(
    localOrderId: string,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    const order = this.getOrderOrThrow(localOrderId);
    if (order.status === "filled") {
      return this.toUpdate(order, now, "Paper order already filled");
    }

    order.status = "cancelled";
    order.lastSyncedAt = now;
    return this.toUpdate(order, now);
  }

  getOrder(localOrderId: string): SimulatedOrderState | undefined {
    return this.orders.get(localOrderId);
  }

  private getOrderOrThrow(localOrderId: string): SimulatedOrderState {
    const order = this.orders.get(localOrderId);
    if (!order) throw new Error(`Unknown paper order ${localOrderId}`);
    return order;
  }

  private toUpdate(
    order: SimulatedOrderState,
    updatedAt: Date,
    reason?: string
  ): OrderLifecycleUpdate {
    return {
      localOrderId: order.localOrderId,
      exchangeOrderId: order.exchangeOrderId,
      status: order.status,
      matchedSizeUsd: order.matchedSizeUsd,
      remainingSizeUsd: Math.max(
        0,
        order.originalSizeUsd - order.matchedSizeUsd
      ),
      updatedAt,
      reason,
    };
  }
}
