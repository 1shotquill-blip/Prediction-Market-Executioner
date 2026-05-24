import type {
  ExchangeOpenOrderState,
  ExchangePortfolioState,
  ExchangePositionState,
} from "../../agent/reconciliation";
import { PolymarketConfigurationError, mapPolymarketError } from "./errors";
import {
  normalizeOpenOrder,
  type PolymarketBalances,
  type PolymarketClientLike,
  type PolymarketPosition,
} from "./types";

function numberFrom(raw: unknown, keys: string[]): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (!raw || typeof raw !== "object") return 0;

  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function stringFrom(raw: unknown, keys: string[], fallback = ""): string {
  if (!raw || typeof raw !== "object") return fallback;
  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return fallback;
}

export function normalizeCashBalance(raw: unknown): number {
  return numberFrom(raw, [
    "cashUsd",
    "usdc",
    "usdcBalance",
    "balance",
    "available",
    "availableBalance",
  ]);
}

export function normalizePolymarketPosition(raw: unknown): PolymarketPosition {
  const size = numberFrom(raw, ["size", "amount", "quantity", "shares"]);
  const valueUsd = numberFrom(raw, [
    "valueUsd",
    "currentValueUsd",
    "value",
    "cashPnl",
  ]);

  return {
    marketId: stringFrom(raw, ["marketId", "market", "conditionId"]),
    tokenId: stringFrom(raw, ["tokenId", "asset", "assetId", "asset_id"]),
    outcome: stringFrom(raw, ["outcome", "title", "name"]),
    size,
    valueUsd,
  };
}

export async function fetchPolymarketBalances(
  client: PolymarketClientLike
): Promise<PolymarketBalances> {
  if (!client.getBalance || !client.getPositions) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose balance/position methods"
    );
  }

  try {
    const [cash, rawPositions] = await Promise.all([
      client.getBalance({ assetType: "collateral" }),
      client.getPositions(),
    ]);
    return {
      cashUsd: normalizeCashBalance(cash),
      positions: rawPositions.map(normalizePolymarketPosition),
    };
  } catch (error) {
    throw mapPolymarketError(error);
  }
}

export function mapPolymarketPositionToExchange(
  position: PolymarketPosition
): ExchangePositionState {
  return {
    marketId: position.marketId,
    tokenId: position.tokenId,
    sizeUsd: position.valueUsd,
    currentValueUsd: position.valueUsd,
  };
}

export async function fetchPolymarketOpenOrders(
  client: PolymarketClientLike
): Promise<ExchangeOpenOrderState[]> {
  if (!client.getOpenOrders) {
    throw new PolymarketConfigurationError(
      "Polymarket client does not expose getOpenOrders"
    );
  }

  try {
    const rawOrders = await client.getOpenOrders();
    return rawOrders.map(raw => {
      const order = normalizeOpenOrder(raw);
      return {
        exchangeOrderId: order.orderId,
        marketId: order.marketId,
        tokenId: order.tokenId,
        side: order.side,
        price: order.price,
        originalSizeUsd: order.originalSizeUsd,
        matchedSizeUsd: order.matchedSizeUsd,
        status: order.status,
      };
    });
  } catch (error) {
    throw mapPolymarketError(error);
  }
}

export async function fetchPolymarketExchangeState(
  client: PolymarketClientLike
): Promise<ExchangePortfolioState> {
  const [balances, openOrders] = await Promise.all([
    fetchPolymarketBalances(client),
    fetchPolymarketOpenOrders(client),
  ]);

  return {
    cashUsd: balances.cashUsd,
    openOrders,
    positions: balances.positions.map(mapPolymarketPositionToExchange),
  };
}
