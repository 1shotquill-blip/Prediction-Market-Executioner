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
import { ensureTradingAllowances } from "./allowances";
import { getPolymarketClient, resetPolymarketClientForTests } from "./client";
import {
  getOrDeriveL2Credentials,
  type CredentialCacheOptions,
} from "./credentials";
import { PolymarketConfigurationError } from "./errors";
import {
  PolymarketKillswitch,
  type PolymarketKillswitchLimits,
} from "./killswitch";
import {
  cancelPolymarketOrder,
  placePolymarketOrder,
  syncPolymarketOrder,
} from "./orders";
import {
  createPolymarketUserReconciler,
  PolymarketUserReconciler,
} from "./reconciler";
import type { PolymarketApiCredentials, PolymarketClientLike } from "./types";

export interface PolymarketAdapterOptions {
  client?: PolymarketClientLike;
  credentials?: PolymarketApiCredentials;
  credentialCache?: CredentialCacheOptions;
  killswitch?: PolymarketKillswitch;
  killswitchLimits?: PolymarketKillswitchLimits;
  requireAllowance?: boolean;
}

export interface PolymarketLiveReadiness {
  ready: boolean;
  missing: string[];
  warnings: string[];
}

interface TrackedOrder {
  exchangeOrderId: string;
  intent: TradeIntent;
  marketId: string;
}

function hasDirectL2Credentials(): boolean {
  return Boolean(
    ENV.polymarketApiKey &&
      ENV.polymarketApiSecret &&
      ENV.polymarketApiPassphrase
  );
}

export function getPolymarketLiveReadiness(): PolymarketLiveReadiness {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!ENV.liveTradingEnabled) missing.push("LIVE_TRADING_ENABLED=true");
  if (!ENV.polymarketClobHost) missing.push("POLYMARKET_HOST");
  if (!Number.isFinite(ENV.polymarketChainId)) {
    missing.push("POLYMARKET_CHAIN_ID");
  }
  if (!ENV.polymarketPrivateKey) missing.push("POLYMARKET_PRIVATE_KEY");
  if (!ENV.polymarketFunderAddress) {
    missing.push("POLYMARKET_FUNDER_ADDRESS");
  }
  if (!ENV.polygonRpcUrl) missing.push("POLYGON_RPC_URL");
  if (!hasDirectL2Credentials() && !ENV.polymarketCredentialCacheKey) {
    missing.push(
      "POLYMARKET_API_KEY/POLYMARKET_API_SECRET/POLYMARKET_API_PASSPHRASE or POLYMARKET_CREDENTIAL_CACHE_KEY"
    );
  }
  if (!ENV.polymarketKillswitchArmed) missing.push("KILLSWITCH_ARMED=true");

  if (ENV.polymarketMaxNotionalUsd <= 0) {
    missing.push("KILLSWITCH_NOTIONAL_CAP_USD > 0");
  }
  if (ENV.polymarketMaxOrdersPerMinute <= 0) {
    missing.push("KILLSWITCH_ORDERS_PER_MIN > 0");
  }
  if (ENV.polymarketPerMarketCapUsd <= 0) {
    missing.push("KILLSWITCH_PER_MARKET_CAP_USD > 0");
  }
  if (ENV.polymarketMaxSpreadBps <= 0) {
    missing.push("KILLSWITCH_MAX_SPREAD_BPS > 0");
  }

  if (
    ENV.polymarketPerMarketCapUsd > 0 &&
    ENV.polymarketPerMarketCapUsd > ENV.polymarketMaxNotionalUsd
  ) {
    warnings.push(
      "KILLSWITCH_PER_MARKET_CAP_USD is above KILLSWITCH_NOTIONAL_CAP_USD; per-order cap will bind first"
    );
  }
  if (!hasDirectL2Credentials()) {
    warnings.push(
      "L2 API credentials will be derived on first live adapter initialization and encrypted on disk"
    );
  }

  return {
    ready: missing.length === 0,
    missing,
    warnings,
  };
}

export class PolymarketAdapter implements ExecutionAdapter {
  private readonly trackedOrders = new Map<string, TrackedOrder>();
  readonly killswitch: PolymarketKillswitch;

  constructor(
    private readonly client: PolymarketClientLike,
    options: Omit<PolymarketAdapterOptions, "client"> = {}
  ) {
    this.killswitch =
      options.killswitch ?? new PolymarketKillswitch(options.killswitchLimits);
    this.requireAllowance = options.requireAllowance ?? true;
  }

  private readonly requireAllowance: boolean;

  static async create(
    options: PolymarketAdapterOptions = {}
  ): Promise<PolymarketAdapter> {
    if (options.client) return new PolymarketAdapter(options.client, options);

    if (!ENV.polymarketPrivateKey) {
      throw new PolymarketConfigurationError(
        "POLYMARKET_PRIVATE_KEY is required for live Polymarket execution"
      );
    }

    const bootstrapClient = await getPolymarketClient({
      forceNew: true,
      credentials: options.credentials,
    });
    const credentials =
      options.credentials ??
      (await getOrDeriveL2Credentials(
        bootstrapClient,
        options.credentialCache
      ));
    const client = await getPolymarketClient({
      forceNew: true,
      credentials,
    });

    return new PolymarketAdapter(client, options);
  }

  reconciler(): PolymarketUserReconciler {
    return createPolymarketUserReconciler(this.client);
  }

  trackExternalOrder(
    localOrderId: string,
    exchangeOrderId: string,
    intent: TradeIntent,
    marketId = intent.marketId
  ): void {
    this.trackedOrders.set(localOrderId, {
      exchangeOrderId,
      intent,
      marketId,
    });
  }

  async place(
    intent: TradeIntent,
    market: AgentMarket,
    now = new Date()
  ): Promise<ExecutionReceipt> {
    this.killswitch.assertMarketCanSubmit(intent.sizeUsd, market, now);
    if (this.requireAllowance) {
      await ensureTradingAllowances(
        this.client,
        intent.sizeUsd,
        intent.tokenId
      );
    }

    const receipt = await placePolymarketOrder(
      this.client,
      intent,
      market,
      now
    );
    if (receipt.status === "exchange_accepted" && receipt.exchangeOrderId) {
      this.trackedOrders.set(receipt.localOrderId, {
        exchangeOrderId: receipt.exchangeOrderId,
        intent,
        marketId: market.marketId,
      });
    }
    return receipt;
  }

  sync(
    localOrderId: string,
    _market: AgentMarket,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    const tracked = this.trackedOrders.get(localOrderId);
    return syncPolymarketOrder(
      this.client,
      localOrderId,
      tracked?.exchangeOrderId,
      now
    );
  }

  async cancel(
    localOrderId: string,
    now = new Date()
  ): Promise<OrderLifecycleUpdate> {
    const tracked = this.trackedOrders.get(localOrderId);
    const update = await cancelPolymarketOrder(
      this.client,
      localOrderId,
      tracked?.exchangeOrderId,
      now
    );
    this.trackedOrders.delete(localOrderId);
    return update;
  }
}

export {
  checkAndApproveAllowance,
  ensureTradingAllowances,
} from "./allowances";
export { getPolymarketClient } from "./client";
export {
  getOrDeriveL2Credentials,
  readCachedL2Credentials,
  writeCachedL2Credentials,
} from "./credentials";
export * from "./errors";
export { PolymarketKillswitch } from "./killswitch";
export {
  cancelPolymarketOrder,
  placePolymarketOrder,
  syncPolymarketOrder,
} from "./orders";
export {
  fetchPolymarketBalances,
  fetchPolymarketExchangeState,
  fetchPolymarketOpenOrders,
} from "./positions";
export {
  createPolymarketUserReconciler,
  PolymarketUserReconciler,
} from "./reconciler";
export * from "./types";
export { resetPolymarketClientForTests };

// ─── Execution Adapter Factory ───────────────────────────────────────────────

import { PaperExecutionAdapter } from "../../agent/paper-execution";
import type { ExecutionAdapter as IExecutionAdapter } from "../../agent/execution-adapter";

export async function createExecutionAdapter(): Promise<IExecutionAdapter> {
  const mode =
    process.env.EXECUTION_MODE ?? (ENV.liveTradingEnabled ? "live" : "paper");

  if (mode === "live") {
    const readiness = getPolymarketLiveReadiness();
    if (!readiness.ready) {
      // Kalshi-only mode: fall back to paper adapter instead of crashing
      console.warn(
        `[Polymarket] Live creds absent — running paper adapter (Kalshi-only mode). Missing: ${readiness.missing.join(", ")}`
      );
      return new PaperExecutionAdapter();
    }
    return PolymarketAdapter.create();
  }

  return new PaperExecutionAdapter();
}
