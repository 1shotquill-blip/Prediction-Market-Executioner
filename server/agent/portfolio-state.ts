import { ENV } from "../_core/env";
import {
  getEquityHistory,
  getLatestEquitySnapshot,
  getMarketByMarketId,
  getOpenOrders,
} from "../db";
import {
  buildPortfolioSnapshot,
  reconcilePortfolio,
  type ExchangeOpenOrderState,
  type ExchangePortfolioState,
  type ExchangePositionState,
  type LocalOrderState,
  type LocalPortfolioState,
  type ReconciliationIssue,
  type ReconciliationResult,
} from "./reconciliation";
import type { PortfolioSnapshot } from "./types";
import { PolymarketAdapter } from "../exchange/polymarket";
import { getKalshiPortfolioState } from "../exchange/kalshi";

export interface ResolvedPortfolioState {
  local: LocalPortfolioState;
  exchange: ExchangePortfolioState | null;
  reconciliation: ReconciliationResult | null;
  snapshot: PortfolioSnapshot;
  issues: ReconciliationIssue[];
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeLocalOrderStatus(
  status: Awaited<ReturnType<typeof getOpenOrders>>[number]["status"]
): LocalOrderState["status"] {
  return status === "cancel_requested" ? "pending" : status;
}

function mapLocalOrder(
  order: Awaited<ReturnType<typeof getOpenOrders>>[number]
): LocalOrderState {
  return {
    localOrderId: order.nonce,
    exchangeOrderId: order.exchangeOrderId ?? undefined,
    marketId: order.marketId,
    tokenId: order.tokenId,
    side: order.side,
    price: toNumber(order.price),
    sizeUsd: toNumber(order.size),
    matchedSizeUsd: toNumber(order.matchedSize),
    status: normalizeLocalOrderStatus(order.status),
    category: undefined,
  };
}

async function annotateLocalOrders(
  openOrders: Awaited<ReturnType<typeof getOpenOrders>>
): Promise<LocalPortfolioState["orders"]> {
  const marketIds = Array.from(
    new Set(openOrders.map(order => order.marketId))
  );
  const marketCategories = new Map<string, string | undefined>();
  await Promise.all(
    marketIds.map(async marketId => {
      const market = await getMarketByMarketId(marketId);
      marketCategories.set(marketId, market?.category ?? undefined);
    })
  );

  return openOrders.map(order => ({
    ...mapLocalOrder(order),
    category: marketCategories.get(order.marketId),
  }));
}

function computePeakBankrollUsd(
  currentBankrollUsd: number,
  history: Awaited<ReturnType<typeof getEquityHistory>>,
  latest?: Awaited<ReturnType<typeof getLatestEquitySnapshot>>
): number {
  const historicalPeak = history.reduce(
    (peak, snapshot) => Math.max(peak, toNumber(snapshot.balance)),
    0
  );
  const latestPeak = latest ? toNumber(latest.peakBalance) : 0;
  return Math.max(currentBankrollUsd, historicalPeak, latestPeak);
}

function computeDailyPnlUsd(
  currentBankrollUsd: number,
  history: Awaited<ReturnType<typeof getEquityHistory>>,
  now: Date
): number {
  const baselineCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const baseline = history
    .filter(snapshot => snapshot.timestamp >= baselineCutoff)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];
  if (!baseline) return 0;
  return currentBankrollUsd - toNumber(baseline.balance);
}

async function annotateExchangeState(
  exchange: ExchangePortfolioState
): Promise<ExchangePortfolioState> {
  const marketIds = new Set<string>();
  for (const position of exchange.positions) marketIds.add(position.marketId);
  for (const order of exchange.openOrders) marketIds.add(order.marketId);

  const marketCategories = new Map<string, string | undefined>();
  await Promise.all(
    Array.from(marketIds).map(async marketId => {
      const market = await getMarketByMarketId(marketId);
      marketCategories.set(marketId, market?.category ?? undefined);
    })
  );

  const positions: ExchangePositionState[] = exchange.positions.map(
    position => ({
      ...position,
      category: marketCategories.get(position.marketId),
    })
  );
  const openOrders: ExchangeOpenOrderState[] = exchange.openOrders.map(
    order => ({
      ...order,
      category: marketCategories.get(order.marketId),
    })
  );

  return { ...exchange, positions, openOrders };
}

function buildLocalSnapshot(
  local: LocalPortfolioState,
  now: Date
): PortfolioSnapshot {
  const marketExposureUsd: Record<string, number> = {};
  const categoryExposureUsd: Record<string, number> = {};
  for (const order of local.orders) {
    const remaining = Math.max(0, order.sizeUsd - order.matchedSizeUsd);
    marketExposureUsd[order.marketId] =
      (marketExposureUsd[order.marketId] ?? 0) + remaining;
    if (order.category) {
      categoryExposureUsd[order.category] =
        (categoryExposureUsd[order.category] ?? 0) + remaining;
    }
  }
  return {
    bankrollUsd: local.bankrollUsd,
    peakBankrollUsd: local.peakBankrollUsd,
    openExposureUsd: Object.values(marketExposureUsd).reduce(
      (sum, value) => sum + value,
      0
    ),
    dailyPnlUsd: local.dailyPnlUsd,
    marketExposureUsd,
    categoryExposureUsd,
    openOrderCount: local.orders.length,
    reconciliationStatus: "unknown",
  };
}

export async function getExchangePortfolioState(
  now = new Date()
): Promise<ResolvedPortfolioState> {
  const [latestEquity, equityHistory, openOrders] = await Promise.all([
    getLatestEquitySnapshot(),
    getEquityHistory(24),
    getOpenOrders(),
  ]);

  const local: LocalPortfolioState = {
    bankrollUsd: latestEquity ? toNumber(latestEquity.balance) : 0,
    peakBankrollUsd: latestEquity ? toNumber(latestEquity.peakBalance) : 0,
    dailyPnlUsd: computeDailyPnlUsd(
      latestEquity ? toNumber(latestEquity.balance) : 0,
      equityHistory,
      now
    ),
    orders: await annotateLocalOrders(openOrders),
  };
  local.peakBankrollUsd = computePeakBankrollUsd(
    local.bankrollUsd,
    equityHistory,
    latestEquity
  );

  const liveMode =
    process.env.EXECUTION_MODE === "live" || ENV.liveTradingEnabled;
  if (!liveMode) {
    return {
      local,
      exchange: null,
      reconciliation: null,
      snapshot: buildLocalSnapshot(local, now),
      issues: [],
    };
  }

  const polymarketConfigured = !!(
    ENV.polymarketPrivateKey && ENV.polymarketFunderAddress
  );

  const [polyState, kalshiState] = await Promise.allSettled([
    polymarketConfigured
      ? PolymarketAdapter.create().then(adapter => adapter.reconciler().poll())
      : Promise.reject(
          new Error("Polymarket not configured — Kalshi-only mode")
        ),
    getKalshiPortfolioState(),
  ]);

  const poly: ExchangePortfolioState =
    polyState.status === "fulfilled"
      ? polyState.value
      : { cashUsd: 0, openOrders: [], positions: [] };
  if (polyState.status === "rejected") {
    console.warn(
      "[PortfolioState] Polymarket reconciliation failed:",
      polyState.reason
    );
  }

  const kalshi: ExchangePortfolioState =
    kalshiState.status === "fulfilled"
      ? kalshiState.value
      : { cashUsd: 0, openOrders: [], positions: [] };
  if (kalshiState.status === "rejected") {
    console.warn(
      "[PortfolioState] Kalshi reconciliation failed:",
      kalshiState.reason
    );
  }

  // Merge both exchanges into a unified view
  const combined: ExchangePortfolioState = {
    cashUsd: poly.cashUsd + kalshi.cashUsd,
    openOrders: [...poly.openOrders, ...kalshi.openOrders],
    positions: [...poly.positions, ...kalshi.positions],
  };

  const exchange = await annotateExchangeState(combined);
  const reconciliation = reconcilePortfolio(local, exchange);

  return {
    local,
    exchange,
    reconciliation,
    snapshot: reconciliation.portfolio,
    issues: reconciliation.issues,
  };
}
