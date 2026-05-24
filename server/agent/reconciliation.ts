import type { PortfolioSnapshot } from "./types";

export type ReconciliationSeverity = "warning" | "critical";

export interface LocalOrderState {
  localOrderId: string;
  exchangeOrderId?: string;
  marketId: string;
  tokenId: string;
  side: "buy" | "sell";
  price: number;
  sizeUsd: number;
  matchedSizeUsd: number;
  status:
    | "pending"
    | "partially_filled"
    | "filled"
    | "cancelled"
    | "expired"
    | "rejected";
  category?: string;
}

export interface ExchangeOpenOrderState {
  exchangeOrderId: string;
  marketId: string;
  tokenId: string;
  side: "buy" | "sell";
  price: number;
  originalSizeUsd: number;
  matchedSizeUsd: number;
  status: string;
  category?: string;
}

export interface ExchangePositionState {
  marketId: string;
  tokenId: string;
  sizeUsd: number;
  currentValueUsd: number;
  category?: string;
}

export interface LocalPortfolioState {
  bankrollUsd: number;
  peakBankrollUsd: number;
  dailyPnlUsd: number;
  orders: LocalOrderState[];
}

export interface ExchangePortfolioState {
  cashUsd: number;
  openOrders: ExchangeOpenOrderState[];
  positions: ExchangePositionState[];
}

export interface ReconciliationIssue {
  severity: ReconciliationSeverity;
  code:
    | "LOCAL_ORDER_MISSING_EXCHANGE_ID"
    | "LOCAL_PENDING_ORDER_NOT_ON_EXCHANGE"
    | "EXCHANGE_ORDER_NOT_LOCAL"
    | "ORDER_PRICE_MISMATCH"
    | "ORDER_SIZE_MISMATCH"
    | "ORDER_MATCHED_SIZE_MISMATCH"
    | "NEGATIVE_CASH_BALANCE";
  message: string;
  localOrderId?: string;
  exchangeOrderId?: string;
  marketId?: string;
}

export interface ReconciliationResult {
  status: "ok" | "mismatch";
  issues: ReconciliationIssue[];
  portfolio: PortfolioSnapshot;
}

export interface ReconciliationTolerances {
  priceTolerance: number;
  sizeToleranceUsd: number;
}

export const DEFAULT_RECONCILIATION_TOLERANCES: ReconciliationTolerances = {
  priceTolerance: 0.0001,
  sizeToleranceUsd: 0.01,
};

function normalizeSide(side: string): "buy" | "sell" {
  return side.toLowerCase() === "sell" ? "sell" : "buy";
}

function isOpenLocalOrder(order: LocalOrderState): boolean {
  return order.status === "pending" || order.status === "partially_filled";
}

function approximatelyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function buildPortfolioSnapshot(
  local: LocalPortfolioState,
  exchange: ExchangePortfolioState,
  reconciliationStatus: "ok" | "mismatch" | "unknown"
): PortfolioSnapshot {
  const marketExposureUsd: Record<string, number> = {};
  const categoryExposureUsd: Record<string, number> = {};

  for (const position of exchange.positions) {
    marketExposureUsd[position.marketId] =
      (marketExposureUsd[position.marketId] ?? 0) +
      Math.max(0, position.currentValueUsd);
    if (position.category) {
      categoryExposureUsd[position.category] =
        (categoryExposureUsd[position.category] ?? 0) +
        Math.max(0, position.currentValueUsd);
    }
  }

  for (const order of exchange.openOrders) {
    const remainingUsd = Math.max(
      0,
      order.originalSizeUsd - order.matchedSizeUsd
    );
    marketExposureUsd[order.marketId] =
      (marketExposureUsd[order.marketId] ?? 0) + remainingUsd;
    if (order.category) {
      categoryExposureUsd[order.category] =
        (categoryExposureUsd[order.category] ?? 0) + remainingUsd;
    }
  }

  const openExposureUsd = Object.values(marketExposureUsd).reduce(
    (sum, value) => sum + value,
    0
  );
  const positionsValueUsd = exchange.positions.reduce(
    (sum, position) => sum + Math.max(0, position.currentValueUsd),
    0
  );
  const bankrollUsd = exchange.cashUsd + positionsValueUsd;

  return {
    bankrollUsd,
    peakBankrollUsd: Math.max(local.peakBankrollUsd, bankrollUsd),
    openExposureUsd,
    dailyPnlUsd: local.dailyPnlUsd,
    marketExposureUsd,
    categoryExposureUsd,
    openOrderCount: exchange.openOrders.length,
    reconciliationStatus,
  };
}

export function reconcilePortfolio(
  local: LocalPortfolioState,
  exchange: ExchangePortfolioState,
  tolerances: ReconciliationTolerances = DEFAULT_RECONCILIATION_TOLERANCES
): ReconciliationResult {
  const issues: ReconciliationIssue[] = [];
  const exchangeById = new Map(
    exchange.openOrders.map(order => [order.exchangeOrderId, order])
  );
  const localOpenOrders = local.orders.filter(isOpenLocalOrder);
  const localExchangeIds = new Set<string>();

  if (exchange.cashUsd < 0) {
    issues.push({
      severity: "critical",
      code: "NEGATIVE_CASH_BALANCE",
      message: "Exchange cash balance is negative",
    });
  }

  for (const localOrder of localOpenOrders) {
    if (!localOrder.exchangeOrderId) {
      issues.push({
        severity: "critical",
        code: "LOCAL_ORDER_MISSING_EXCHANGE_ID",
        message: "Local open order has no exchange order id",
        localOrderId: localOrder.localOrderId,
        marketId: localOrder.marketId,
      });
      continue;
    }

    localExchangeIds.add(localOrder.exchangeOrderId);
    const exchangeOrder = exchangeById.get(localOrder.exchangeOrderId);
    if (!exchangeOrder) {
      issues.push({
        severity: "critical",
        code: "LOCAL_PENDING_ORDER_NOT_ON_EXCHANGE",
        message: "Local open order is not present in exchange open orders",
        localOrderId: localOrder.localOrderId,
        exchangeOrderId: localOrder.exchangeOrderId,
        marketId: localOrder.marketId,
      });
      continue;
    }

    if (
      !approximatelyEqual(
        localOrder.price,
        exchangeOrder.price,
        tolerances.priceTolerance
      )
    ) {
      issues.push({
        severity: "critical",
        code: "ORDER_PRICE_MISMATCH",
        message: "Local order price does not match exchange order price",
        localOrderId: localOrder.localOrderId,
        exchangeOrderId: exchangeOrder.exchangeOrderId,
        marketId: localOrder.marketId,
      });
    }

    if (
      !approximatelyEqual(
        localOrder.sizeUsd,
        exchangeOrder.originalSizeUsd,
        tolerances.sizeToleranceUsd
      )
    ) {
      issues.push({
        severity: "critical",
        code: "ORDER_SIZE_MISMATCH",
        message: "Local order size does not match exchange order size",
        localOrderId: localOrder.localOrderId,
        exchangeOrderId: exchangeOrder.exchangeOrderId,
        marketId: localOrder.marketId,
      });
    }

    if (
      !approximatelyEqual(
        localOrder.matchedSizeUsd,
        exchangeOrder.matchedSizeUsd,
        tolerances.sizeToleranceUsd
      )
    ) {
      issues.push({
        severity: "warning",
        code: "ORDER_MATCHED_SIZE_MISMATCH",
        message: "Local matched size does not match exchange matched size",
        localOrderId: localOrder.localOrderId,
        exchangeOrderId: exchangeOrder.exchangeOrderId,
        marketId: localOrder.marketId,
      });
    }
  }

  for (const exchangeOrder of exchange.openOrders) {
    if (!localExchangeIds.has(exchangeOrder.exchangeOrderId)) {
      issues.push({
        severity: "critical",
        code: "EXCHANGE_ORDER_NOT_LOCAL",
        message: "Exchange has an open order missing from local state",
        exchangeOrderId: exchangeOrder.exchangeOrderId,
        marketId: exchangeOrder.marketId,
      });
    }
  }

  const hasCriticalIssue = issues.some(issue => issue.severity === "critical");
  const status = hasCriticalIssue ? "mismatch" : "ok";

  return {
    status,
    issues,
    portfolio: buildPortfolioSnapshot(local, exchange, status),
  };
}

export function mapClobOpenOrder(
  raw: Record<string, unknown>
): ExchangeOpenOrderState {
  return {
    exchangeOrderId: String(raw.id ?? ""),
    marketId: String(raw.market ?? ""),
    tokenId: String(raw.asset_id ?? ""),
    side: normalizeSide(String(raw.side ?? "buy")),
    price: Number(raw.price ?? 0),
    originalSizeUsd: Number(raw.original_size ?? 0),
    matchedSizeUsd: Number(raw.size_matched ?? 0),
    status: String(raw.status ?? ""),
  };
}
