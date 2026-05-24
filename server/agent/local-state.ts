import { getReconcilableOrders, getLatestEquitySnapshot } from "../db";
import type { Order } from "../../drizzle/schema";
import type { LocalOrderState, LocalPortfolioState } from "./reconciliation";

export function mapDbOrderToLocalOrder(order: Order): LocalOrderState {
  const sizeUsd = Number(order.size) * Number(order.price);

  return {
    localOrderId: order.nonce,
    exchangeOrderId: order.exchangeOrderId ?? undefined,
    marketId: order.marketId,
    tokenId: order.tokenId,
    side: order.side,
    price: Number(order.price),
    sizeUsd,
    matchedSizeUsd: Number(order.matchedSize) * Number(order.price),
    status: order.status === "cancel_requested" ? "pending" : order.status,
  };
}

export async function readLocalPortfolioState(): Promise<LocalPortfolioState> {
  const [openOrders, latestEquity] = await Promise.all([
    getReconcilableOrders(),
    getLatestEquitySnapshot(),
  ]);
  const bankrollUsd = latestEquity ? Number(latestEquity.balance) : 0;
  const peakBankrollUsd = latestEquity
    ? Number(latestEquity.peakBalance)
    : bankrollUsd;

  return {
    bankrollUsd,
    peakBankrollUsd,
    dailyPnlUsd: 0,
    orders: openOrders.map(mapDbOrderToLocalOrder),
  };
}
