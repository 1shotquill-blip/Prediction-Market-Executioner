import type { AgentMarket, ExecutionReceipt, TradeIntent } from "./types";
import { computeExecutionMicrostructureProfile } from "./execution-microstructure";

export type OrderLifecycleStatus =
  | "accepted"
  | "partially_filled"
  | "filled"
  | "cancel_requested"
  | "cancelled"
  | "expired"
  | "rejected";

export interface ExecutionAdapter {
  place(
    intent: TradeIntent,
    market: AgentMarket,
    now?: Date
  ): Promise<ExecutionReceipt>;
  sync(
    localOrderId: string,
    market: AgentMarket,
    now?: Date
  ): Promise<OrderLifecycleUpdate>;
  cancel(localOrderId: string, now?: Date): Promise<OrderLifecycleUpdate>;
}

export interface OrderLifecycleUpdate {
  localOrderId: string;
  exchangeOrderId?: string;
  status: OrderLifecycleStatus;
  matchedSizeUsd: number;
  remainingSizeUsd: number;
  updatedAt: Date;
  reason?: string;
}

export interface SimulatedOrderState {
  localOrderId: string;
  exchangeOrderId: string;
  intent: TradeIntent;
  originalSizeUsd: number;
  matchedSizeUsd: number;
  acceptedAt: Date;
  lastSyncedAt: Date;
  expiresAt: Date;
  status: OrderLifecycleStatus;
}

export interface PaperExecutionOptions {
  orderTtlMs: number;
  partialFillRatio: number;
}

export const DEFAULT_PAPER_EXECUTION_OPTIONS: PaperExecutionOptions = {
  orderTtlMs: 30_000,
  partialFillRatio: 0.5,
};

export function isIntentImmediatelyMarketable(
  intent: TradeIntent,
  market: AgentMarket
): boolean {
  if (intent.side === "buy") return intent.limitPrice >= market.bestAsk;
  return intent.limitPrice <= market.bestBid;
}

export function computePaperFillSizeUsd(
  intent: TradeIntent,
  market: AgentMarket,
  remainingSizeUsd: number,
  options: PaperExecutionOptions = DEFAULT_PAPER_EXECUTION_OPTIONS
): number {
  if (remainingSizeUsd <= 0) return 0;
  if (!isIntentImmediatelyMarketable(intent, market)) return 0;

  const microstructure = computeExecutionMicrostructureProfile(market);
  const liquidityCap = Math.max(0, market.liquidity * 0.02);
  const maxFill = Math.min(
    remainingSizeUsd,
    (liquidityCap || remainingSizeUsd) * microstructure.sizeMultiplier
  );
  if (maxFill >= remainingSizeUsd) return remainingSizeUsd;
  return Math.max(
    0,
    Math.min(remainingSizeUsd, maxFill * options.partialFillRatio)
  );
}
