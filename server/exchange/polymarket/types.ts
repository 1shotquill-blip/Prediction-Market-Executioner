import type { OrderLifecycleStatus } from "../../agent/execution-adapter";
import type { AgentMarket, TradeIntent, TradeSide } from "../../agent/types";

export type PolymarketOrderSide = "BUY" | "SELL";
export type PolymarketOrderType = "GTC";

export interface PolymarketApiCredentials {
  key: string;
  secret: string;
  passphrase: string;
}

export interface PolymarketSignedOrderRequest {
  tokenID: string;
  price: number;
  side: PolymarketOrderSide;
  size: number;
  feeRateBps?: number;
  nonce?: string;
}

export interface PolymarketPostedOrder {
  orderId: string;
  status: "live" | "matched" | "delayed" | "unmatched" | "rejected";
  raw: unknown;
}

export interface PolymarketOpenOrder {
  orderId: string;
  marketId: string;
  tokenId: string;
  side: TradeSide;
  price: number;
  originalSizeUsd: number;
  matchedSizeUsd: number;
  status: OrderLifecycleStatus;
}

export interface PolymarketTradeFill {
  orderId: string;
  marketId: string;
  tokenId: string;
  price: number;
  size: number;
  side: TradeSide;
  timestamp: Date;
}

export interface PolymarketPosition {
  marketId: string;
  tokenId: string;
  outcome: string;
  size: number;
  valueUsd: number;
}

export interface PolymarketBalances {
  cashUsd: number;
  positions: PolymarketPosition[];
}

export interface PolymarketClientLike {
  createOrDeriveApiKey?():
    | Promise<PolymarketApiCredentials>
    | PolymarketApiCredentials;
  getApiKeys?():
    | Promise<PolymarketApiCredentials[]>
    | PolymarketApiCredentials[];
  createAndPostOrder?(
    order: PolymarketSignedOrderRequest,
    marketOptions: { tickSize: string; negRisk?: boolean },
    orderType?: PolymarketOrderType
  ): Promise<unknown>;
  createOrder?(
    order: PolymarketSignedOrderRequest,
    marketOptions?: { tickSize: string; negRisk?: boolean }
  ): Promise<unknown>;
  postOrder?(
    signedOrder: unknown,
    orderType?: PolymarketOrderType,
    postOnly?: boolean
  ): Promise<unknown>;
  cancel?(orderId: string): Promise<unknown>;
  cancelOrder?(payload: { orderID: string }): Promise<unknown>;
  getOrder?(orderId: string): Promise<unknown>;
  getOpenOrders?(params?: Record<string, unknown>): Promise<unknown[]>;
  getTrades?(params?: Record<string, unknown>): Promise<unknown[]>;
  getBalanceAllowance?(params?: Record<string, unknown>): Promise<unknown>;
  updateBalanceAllowance?(params?: Record<string, unknown>): Promise<unknown>;
  getBalance?(params?: Record<string, unknown>): Promise<unknown>;
  getPositions?(params?: Record<string, unknown>): Promise<unknown[]>;
}

export interface PolymarketClientConfig {
  host: string;
  chainId: number;
  privateKey: string;
  rpcUrl?: string;
  funderAddress?: string;
  signatureType?: number;
  credentials?: PolymarketApiCredentials;
}

export function mapOrderSide(side: TradeSide): PolymarketOrderSide {
  return side === "buy" ? "BUY" : "SELL";
}

export function mapTradeIntentToPolymarketOrder(
  intent: TradeIntent
): PolymarketSignedOrderRequest {
  return {
    tokenID: intent.tokenId,
    price: intent.limitPrice,
    side: mapOrderSide(intent.side),
    size: intent.limitPrice > 0 ? intent.sizeUsd / intent.limitPrice : 0,
  };
}

export function normalizePostedOrder(raw: unknown): PolymarketPostedOrder {
  const value = raw as Record<string, unknown>;
  const orderId = String(
    value.orderID ?? value.orderId ?? value.id ?? value.hash ?? ""
  );
  const status = String(
    value.status ?? value.orderStatus ?? "live"
  ).toLowerCase();
  return {
    orderId,
    status:
      status === "matched" ||
      status === "delayed" ||
      status === "unmatched" ||
      status === "rejected"
        ? status
        : "live",
    raw,
  };
}

export function normalizeOpenOrder(raw: unknown): PolymarketOpenOrder {
  const value = raw as Record<string, unknown>;
  const price = Number(value.price ?? value.limitPrice ?? 0);
  const originalTokenSize = Number(
    value.original_size ?? value.originalSize ?? value.size ?? 0
  );
  const matchedTokenSize = Number(
    value.size_matched ?? value.matchedSize ?? value.filledSize ?? 0
  );
  const side =
    String(value.side ?? "").toUpperCase() === "SELL" ? "sell" : "buy";
  return {
    orderId: String(
      value.id ?? value.orderID ?? value.orderId ?? value.hash ?? ""
    ),
    marketId: String(
      value.market ?? value.marketId ?? value.condition_id ?? ""
    ),
    tokenId: String(value.asset_id ?? value.tokenId ?? value.tokenID ?? ""),
    side,
    price,
    originalSizeUsd: originalTokenSize * price,
    matchedSizeUsd: matchedTokenSize * price,
    status: matchedTokenSize > 0 ? "partially_filled" : "accepted",
  };
}

export function normalizeMarketFromIntent(
  intent: TradeIntent,
  market: AgentMarket
): string {
  return market.conditionId ?? intent.marketId;
}
