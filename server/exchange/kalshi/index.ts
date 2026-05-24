import { nanoid } from "nanoid";
import { ENV } from "../../_core/env";
import type {
  ExecutionAdapter,
  OrderLifecycleUpdate,
} from "../../agent/execution-adapter";
import type {
  AgentMarket,
  ExecutionReceipt,
  TradeIntent,
} from "../../agent/types";
import { PaperExecutionAdapter } from "../../agent/paper-execution";
import { KalshiClient } from "./client";
import {
  cancelKalshiOrder,
  getKalshiOrderStatus,
  placeKalshiLimitOrder,
} from "./orders";
import { listKalshiMarkets, getKalshiMarket } from "./markets";
import { KalshiConfigurationError, hasKalshiCredentials } from "./auth";

// ─── Killswitch ───────────────────────────────────────────────────────────────

export class KalshiKillswitch {
  private disarmed = false;

  constructor(private readonly armed = ENV.kalshiKillswitchArmed) {}

  async disarm(): Promise<void> {
    this.disarmed = true;
    console.error("[KalshiKillswitch] DISARMED - blocking all new orders");
  }

  isArmed(): boolean {
    return this.armed && !this.disarmed;
  }

  assertCanSubmit(): void {
    if (ENV.kalshiExecutionMode === "live" && !this.isArmed()) {
      throw new KalshiConfigurationError(
        "KALSHI_KILLSWITCH_ARMED must be true before Kalshi live order submission"
      );
    }
    if (!this.isArmed()) {
      throw new KalshiConfigurationError(
        "Kalshi killswitch is not armed — order submission blocked"
      );
    }
  }
}

// ─── Live execution adapter ───────────────────────────────────────────────────

export class KalshiLiveExecutionAdapter implements ExecutionAdapter {
  readonly killswitch: KalshiKillswitch;
  private readonly exchangeOrderIds = new Map<string, string>();

  constructor(
    private readonly client = new KalshiClient(),
    killswitch = new KalshiKillswitch()
  ) {
    this.killswitch = killswitch;
  }

  async place(
    intent: TradeIntent,
    market: AgentMarket,
    now = new Date()
  ): Promise<ExecutionReceipt> {
    this.killswitch.assertCanSubmit();
    if (market.exchange && market.exchange !== "kalshi") {
      return {
        localOrderId: `kalshi-rejected-${now.getTime()}-${nanoid(8)}`,
        status: "rejected",
        submittedAt: now,
        rejectionReason: "Kalshi adapter received non-Kalshi market",
      };
    }
    const receipt = await placeKalshiLimitOrder(
      this.client,
      { ...intent, exchange: "kalshi" },
      { ...market, exchange: "kalshi" },
      now
    );
    if (receipt.exchangeOrderId) {
      this.exchangeOrderIds.set(receipt.localOrderId, receipt.exchangeOrderId);
    }
    return receipt;
  }

  sync(
    localOrderId: string,
    _market: AgentMarket,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    return getKalshiOrderStatus(
      this.client,
      localOrderId,
      this.exchangeOrderIds.get(localOrderId),
      now
    );
  }

  cancel(
    localOrderId: string,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    return cancelKalshiOrder(
      this.client,
      localOrderId,
      this.exchangeOrderIds.get(localOrderId),
      now
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export async function createKalshiExecutionAdapter(): Promise<ExecutionAdapter> {
  if (ENV.kalshiExecutionMode === "live") {
    if (!hasKalshiCredentials()) {
      throw new KalshiConfigurationError(
        "KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PEM (or KALSHI_PRIVATE_KEY_PATH) are required for Kalshi live execution"
      );
    }
    return new KalshiLiveExecutionAdapter();
  }
  return new PaperExecutionAdapter();
}

// ─── Portfolio state ──────────────────────────────────────────────────────────

export interface KalshiPortfolioState {
  cashUsd: number;
  openOrders: Array<{
    exchangeOrderId: string;
    marketId: string;
    tokenId: string;
    side: "buy" | "sell";
    price: number;
    originalSizeUsd: number;
    matchedSizeUsd: number;
    status: string;
  }>;
  positions: Array<{
    marketId: string;
    tokenId: string;
    sizeUsd: number;
    currentValueUsd: number;
  }>;
}

export async function getKalshiPortfolioState(): Promise<KalshiPortfolioState> {
  const client = new KalshiClient();

  const [balanceBody, ordersBody, positionsBody] = await Promise.all([
    client.request<{ balance?: number; portfolio?: { balance?: number } }>(
      "/portfolio/balance"
    ),
    client.request<{
      orders?: Array<Record<string, unknown>>;
    }>("/portfolio/orders?status=resting"),
    client.request<{
      market_positions?: Array<Record<string, unknown>>;
    }>("/portfolio/positions"),
  ]);

  const cents = Number(
    balanceBody.balance ?? balanceBody.portfolio?.balance ?? 0
  );
  const cashUsd = Number.isFinite(cents) ? cents / 100 : 0;

  const openOrders = (ordersBody.orders ?? []).map(order => {
    const count = Number(order.count ?? 0);
    const remainingCount = Number(order.remaining_count ?? count);
    const yesPrice = Number(order.yes_price ?? 0) / 100;
    const noPrice = Number(order.no_price ?? 0) / 100;
    const price = yesPrice > 0 ? yesPrice : noPrice;
    const filledCount = count - remainingCount;
    return {
      exchangeOrderId: String(order.order_id ?? order.id ?? ""),
      marketId: String(order.ticker ?? ""),
      tokenId: String(order.ticker ?? ""),
      side: "buy" as const,
      price,
      originalSizeUsd: count * price,
      matchedSizeUsd: filledCount * price,
      status: String(order.status ?? "resting"),
    };
  });

  const positions = (positionsBody.market_positions ?? []).map(position => {
    const yesContracts = Number(position.position ?? 0);
    const noContracts = Number(position.no_position ?? 0);
    const contracts = Math.max(yesContracts, noContracts);
    const marketValue = Number(position.market_exposure ?? contracts) / 100;
    return {
      marketId: String(position.market_id ?? position.ticker ?? ""),
      tokenId: String(position.market_id ?? position.ticker ?? ""),
      sizeUsd: marketValue,
      currentValueUsd: marketValue,
    };
  });

  return { cashUsd, openOrders, positions };
}

export async function getKalshiCashBalance(): Promise<number | null> {
  if (!hasKalshiCredentials()) return null;
  const client = new KalshiClient();
  const body = await client.request<{
    balance?: number;
    portfolio?: { balance?: number };
  }>("/portfolio/balance");
  const cents = Number(body.balance ?? body.portfolio?.balance ?? 0);
  return Number.isFinite(cents) ? cents / 100 : null;
}

export {
  KalshiClient,
  listKalshiMarkets,
  getKalshiMarket,
  placeKalshiLimitOrder,
  cancelKalshiOrder,
  getKalshiOrderStatus,
};
