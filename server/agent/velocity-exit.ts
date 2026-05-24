import { insertOrder } from "../db";
import type { InsertOrder } from "../../drizzle/schema";
import type { AgentMarket, ExecutionReceipt, TradeIntent } from "./types";
import type { ExecutionAdapter } from "./execution-adapter";

export const DEFAULT_VELOCITY_EXIT_PROFIT_TARGET_PCT = 0.2;
export const DEFAULT_VELOCITY_EXIT_MIN_GAIN_PCT = 0.2;
export const DEFAULT_VELOCITY_EXIT_MIN_VALUE_USD = 10;
export const DEFAULT_VELOCITY_EXIT_MAX_TRADES = 50;

export interface VelocityExitTrade {
  side: "buy" | "sell";
  price: number;
  size: number;
}

export interface VelocityExitPosition {
  marketId: string;
  tokenId: string;
  currentValueUsd: number;
  sizeUsd: number;
}

export interface VelocityExitCandidate {
  market: AgentMarket;
  position: VelocityExitPosition;
  entryPrice: number;
  gainPct: number;
  intent: TradeIntent;
}

function clampNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function computeAverageEntryPrice(
  trades: VelocityExitTrade[]
): number | null {
  let positionTokens = 0;
  let positionCostUsd = 0;

  for (const trade of trades
    .slice()
    .filter(
      trade =>
        Number.isFinite(trade.price) &&
        trade.price > 0 &&
        Number.isFinite(trade.size) &&
        trade.size > 0
    )) {
    const size = clampNumber(trade.size);
    const price = clampNumber(trade.price);
    if (trade.side === "buy") {
      positionTokens += size;
      positionCostUsd += size * price;
      continue;
    }

    if (positionTokens <= 0) continue;
    const averageCost = positionCostUsd / positionTokens;
    const soldTokens = Math.min(size, positionTokens);
    positionTokens -= soldTokens;
    positionCostUsd -= soldTokens * averageCost;
    if (positionTokens <= 1e-9) {
      positionTokens = 0;
      positionCostUsd = 0;
    }
  }

  if (positionTokens <= 0 || positionCostUsd <= 0) return null;
  return positionCostUsd / positionTokens;
}

export function buildVelocityExitCandidate(args: {
  market: AgentMarket;
  position: VelocityExitPosition;
  trades: VelocityExitTrade[];
  now?: Date;
  profitTargetPct?: number;
  minGainPct?: number;
  minValueUsd?: number;
}): VelocityExitCandidate | null {
  const {
    market,
    position,
    trades,
    now = new Date(),
    profitTargetPct = DEFAULT_VELOCITY_EXIT_PROFIT_TARGET_PCT,
    minGainPct = DEFAULT_VELOCITY_EXIT_MIN_GAIN_PCT,
    minValueUsd = DEFAULT_VELOCITY_EXIT_MIN_VALUE_USD,
  } = args;

  if (position.currentValueUsd < minValueUsd) return null;
  if (!Number.isFinite(market.bestBid) || market.bestBid <= 0) return null;
  if (!Number.isFinite(market.orderbookUpdatedAt.getTime())) return null;

  const marketAgeSeconds =
    (now.getTime() - market.orderbookUpdatedAt.getTime()) / 1000;
  if (marketAgeSeconds > 30) return null;

  const entryPrice = computeAverageEntryPrice(trades);
  if (!entryPrice || entryPrice <= 0) return null;

  const gainPct = market.bestBid / entryPrice - 1;
  if (!Number.isFinite(gainPct) || gainPct < minGainPct) return null;
  if (market.bestBid < entryPrice * (1 + profitTargetPct)) return null;

  const sizeUsd = Math.max(0, position.currentValueUsd);
  if (sizeUsd <= 0) return null;

  return {
    market,
    position,
    entryPrice,
    gainPct,
    intent: {
      marketId: position.marketId,
      tokenId: position.tokenId,
      outcome: "yes",
      side: "sell",
      limitPrice: market.bestBid,
      sizeUsd,
      edge: gainPct,
      estimatedProbability: market.bestBid,
      confidence: 0.5,
      rationale: [
        "velocity exit: captured fast-moving profit and recycled capital",
        `entry price ${entryPrice.toFixed(4)} vs bid ${market.bestBid.toFixed(
          4
        )}`,
      ],
    },
  };
}

export async function submitVelocityExitOrder(
  adapter: ExecutionAdapter,
  candidate: VelocityExitCandidate,
  now = new Date()
): Promise<ExecutionReceipt> {
  const receipt = await adapter.place(candidate.intent, candidate.market, now);
  if (receipt.status === "rejected" || !receipt.exchangeOrderId) {
    return receipt;
  }

  const orderData: InsertOrder = {
    nonce: receipt.localOrderId,
    exchangeOrderId: receipt.exchangeOrderId,
    marketId: candidate.intent.marketId,
    tokenId: candidate.intent.tokenId,
    side: candidate.intent.side,
    price: candidate.intent.limitPrice.toString(),
    size: (candidate.intent.sizeUsd / candidate.intent.limitPrice).toString(),
    matchedSize: "0",
    status: "pending",
    lifecycleState: "ACCEPTED_BY_CLOB",
    edgeAtPlacement: candidate.intent.edge.toString(),
    confidenceAtPlacement: candidate.intent.confidence.toString(),
    placedAt: receipt.submittedAt,
    acceptedAt: receipt.submittedAt,
    lastSyncedAt: receipt.submittedAt,
  };
  await insertOrder(orderData);

  return receipt;
}
