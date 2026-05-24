import type { RiskLimits } from "./types";
import { updateBotConfig } from "../db";

export interface PerformanceSummary {
  winRate24h: number; // 0–1
  avgSpread24h: number; // average spread seen across scanned markets
  tradeCount24h: number;
  dailyPnlUsd: number;
}

export interface AdaptiveAdjustment {
  minEdge: number;
  fractionalKelly: number;
  maxOrderSizeUsd: number;
  maxDrawdownPct: number;
  reason: string;
}

/**
 * Compute adaptive risk limits based on recent performance and market conditions.
 * Returns tightened or loosened limits relative to the base.
 * All adjustments are conservative — never more aggressive than base limits.
 */
export function calculateAdaptiveLimits(
  base: RiskLimits,
  perf: PerformanceSummary
): RiskLimits & { _adaptive: AdaptiveAdjustment } {
  let minEdge = base.minEdge;
  let fractionalKelly = base.fractionalKelly;
  let maxOrderSizeUsd = base.maxOrderSizeUsd;
  let maxDrawdownPct = base.maxDrawdownPct;
  const reasons: string[] = [];

  // Volatility scaling: wide spreads → require more edge, reduce kelly
  if (perf.avgSpread24h > 0.08) {
    minEdge = Math.min(0.15, minEdge * 1.3);
    fractionalKelly = Math.max(0.1, fractionalKelly * 0.7);
    reasons.push(`high_spread(${perf.avgSpread24h.toFixed(3)})`);
  } else if (perf.avgSpread24h > 0.05) {
    minEdge = Math.min(0.12, minEdge * 1.15);
    fractionalKelly = Math.max(0.12, fractionalKelly * 0.85);
    reasons.push(`elevated_spread(${perf.avgSpread24h.toFixed(3)})`);
  }

  // Performance scaling: poor win rate → tighten everything
  if (perf.tradeCount24h >= 3 && perf.winRate24h < 0.4) {
    minEdge = Math.min(0.15, minEdge * 1.25);
    maxDrawdownPct = Math.max(5, maxDrawdownPct * 0.8);
    maxOrderSizeUsd = Math.max(1, maxOrderSizeUsd * 0.7);
    fractionalKelly = Math.max(0.1, fractionalKelly * 0.6);
    reasons.push(`low_win_rate(${(perf.winRate24h * 100).toFixed(1)}%)`);
  }

  // Daily loss approaching stop → cut size further
  if (perf.dailyPnlUsd < -2) {
    maxOrderSizeUsd = Math.max(1, maxOrderSizeUsd * 0.5);
    reasons.push(`near_daily_stop(pnl=${perf.dailyPnlUsd.toFixed(2)})`);
  }

  const adjustment: AdaptiveAdjustment = {
    minEdge,
    fractionalKelly,
    maxOrderSizeUsd,
    maxDrawdownPct,
    reason: reasons.length > 0 ? reasons.join(";") : "nominal",
  };

  return {
    ...base,
    minEdge,
    fractionalKelly,
    maxOrderSizeUsd,
    maxDrawdownPct,
    _adaptive: adjustment,
  };
}

/** Persist adaptive adjustment to bot_config so dashboard reflects it. */
export async function persistAdaptiveAdjustment(
  adj: AdaptiveAdjustment
): Promise<void> {
  try {
    await updateBotConfig({
      edgeThreshold: adj.minEdge.toString(),
      kellyFraction: adj.fractionalKelly.toString(),
    });
  } catch {
    // Non-fatal — adaptive log is advisory
  }

  // Write to .manus-logs/ as required by spec
  try {
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(".manus-logs", { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      type: "adaptive_risk",
      ...adj,
    };
    await writeFile(
      `.manus-logs/adaptive-${Date.now()}.json`,
      JSON.stringify(entry, null, 2)
    );
  } catch {
    // Non-fatal
  }
}
