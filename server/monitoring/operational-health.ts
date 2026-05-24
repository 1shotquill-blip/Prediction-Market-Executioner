import { ENV } from "../_core/env";
import {
  getBotConfig,
  getEquityHistory,
  getLatestEquitySnapshot,
  getOpenOrders,
  getRecentDecisionAudits,
  getRecentTrades,
} from "../db";
import { getPolymarketLiveReadiness } from "../exchange/polymarket";
import { summarizeShadowReplay } from "./shadow-replay";

export interface OperationalHealthSnapshot {
  ok: boolean;
  generatedAt: Date;
  botConfig?: Awaited<ReturnType<typeof getBotConfig>>;
  liveReadiness: ReturnType<typeof getPolymarketLiveReadiness>;
  latestEquitySnapshot?: Awaited<ReturnType<typeof getLatestEquitySnapshot>>;
  equityHistoryPoints: number;
  recentTradeCount: number;
  recentTradeNotionalUsd: number;
  recentAuditCount: number;
  shadowReplay: ReturnType<typeof summarizeShadowReplay>;
  openOrderCount: number;
  staleOpenOrderCount: number;
  issues: string[];
}

function tradeNotionalUsd(
  row: Awaited<ReturnType<typeof getRecentTrades>>[number]
): number {
  const notional = Number(row.usdcValue);
  if (Number.isFinite(notional)) return notional;
  return Number(row.size) * Number(row.price);
}

export async function collectOperationalHealthSnapshot(
  now = new Date()
): Promise<OperationalHealthSnapshot> {
  const [
    botConfig,
    liveReadiness,
    latestEquitySnapshot,
    equityHistory,
    trades,
    audits,
    openOrders,
  ] = await Promise.all([
    getBotConfig(),
    Promise.resolve(getPolymarketLiveReadiness()),
    getLatestEquitySnapshot(),
    getEquityHistory(24),
    getRecentTrades(100),
    getRecentDecisionAudits(100),
    getOpenOrders(),
  ]);

  const staleOpenOrderCount = openOrders.filter(order => {
    const placedAt = new Date(order.placedAt);
    return now.getTime() - placedAt.getTime() > ENV.orderTtlMs;
  }).length;

  const recentTradeNotionalUsd = trades.reduce(
    (sum, trade) => sum + tradeNotionalUsd(trade),
    0
  );
  const shadowReplay = summarizeShadowReplay(audits);

  const issues: string[] = [];
  if (botConfig?.isRunning === 0) issues.push("bot is stopped");
  if (botConfig?.isPaused === 1) issues.push("bot is paused");
  if (botConfig?.emergencyBrakeTriggered === 1) {
    issues.push("emergency brake is triggered");
  }
  if (!liveReadiness.ready && botConfig?.executionMode === "live") {
    issues.push(`live readiness missing: ${liveReadiness.missing.join(", ")}`);
  }
  if (staleOpenOrderCount > 0) {
    issues.push(`${staleOpenOrderCount} stale open orders require attention`);
  }

  return {
    ok: issues.length === 0 && liveReadiness.ready,
    generatedAt: now,
    botConfig,
    liveReadiness,
    latestEquitySnapshot,
    equityHistoryPoints: equityHistory.length,
    recentTradeCount: trades.length,
    recentTradeNotionalUsd,
    recentAuditCount: audits.length,
    shadowReplay,
    openOrderCount: openOrders.length,
    staleOpenOrderCount,
    issues,
  };
}
