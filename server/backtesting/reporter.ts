import { summarizePerformance, type SettledTrade } from "../agent/performance";
import type { BacktestEquityPoint, BacktestRunResult } from "./engine";

export interface BacktestReport {
  summary: ReturnType<typeof summarizePerformance>;
  finalBankrollUsd: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  equityCurve: BacktestEquityPoint[];
  trades: SettledTrade[];
  unresolvedTradeCount: number;
}

export interface BacktestSensitivityScenario {
  name: string;
  minEdge?: number;
  minConfidence?: number;
  maxOrdersPerTick?: number;
}

function computeMaxDrawdown(equityCurve: BacktestEquityPoint[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.balanceUsd);
    if (peak <= 0) continue;
    const drawdown = ((peak - point.balanceUsd) / peak) * 100;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }
  return maxDrawdown;
}

function computeSharpeRatio(equityCurve: BacktestEquityPoint[]): number {
  if (equityCurve.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1]?.balanceUsd ?? 0;
    const curr = equityCurve[i]?.balanceUsd ?? 0;
    if (prev <= 0) continue;
    returns.push((curr - prev) / prev);
  }
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return mean / stdDev;
}

export function generateBacktestReport(
  result: BacktestRunResult
): BacktestReport {
  const summary = summarizePerformance(result.trades);
  const firstBalance = result.equityCurve[0]?.balanceUsd ?? 0;
  const finalBalance =
    result.equityCurve[result.equityCurve.length - 1]?.balanceUsd ??
    result.finalBankrollUsd;
  const totalReturnPct =
    firstBalance > 0 ? ((finalBalance - firstBalance) / firstBalance) * 100 : 0;

  return {
    summary,
    finalBankrollUsd: finalBalance,
    totalReturnPct,
    maxDrawdownPct: computeMaxDrawdown(result.equityCurve),
    sharpeRatio: computeSharpeRatio(result.equityCurve),
    equityCurve: result.equityCurve,
    trades: result.trades,
    unresolvedTradeCount: result.unresolvedTradeCount,
  };
}

export async function runBacktestSensitivity<
  TOptions extends Record<string, unknown>,
>(
  scenarios: BacktestSensitivityScenario[],
  runBacktest: (
    scenario: BacktestSensitivityScenario
  ) => Promise<BacktestRunResult>
): Promise<
  Array<{ scenario: BacktestSensitivityScenario; report: BacktestReport }>
> {
  const results: Array<{
    scenario: BacktestSensitivityScenario;
    report: BacktestReport;
  }> = [];
  for (const scenario of scenarios) {
    const outcome = await runBacktest(scenario);
    results.push({
      scenario,
      report: generateBacktestReport(outcome),
    });
  }
  return results;
}
