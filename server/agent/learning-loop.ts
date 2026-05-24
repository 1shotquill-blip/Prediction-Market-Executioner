import { updateBotConfig, upsertBayesianPrior } from "../db";
import type { InsertBayesianPrior } from "../../drizzle/schema";
import { summarizePerformance, type SettledTrade } from "./performance";
import type { LearningProfile } from "./opportunity-ranking";

export interface LearningCategorySignal {
  category: string;
  wins: number;
  losses: number;
  winRate: number;
  priorProbability: number;
  sampleSize: number;
}

export interface LearningLoopSignal {
  performance: ReturnType<typeof summarizePerformance>;
  hiddenEdgeHitRate: number;
  hiddenEdgePnlUsd: number;
  categorySignals: LearningCategorySignal[];
  recommendedEdgeThreshold: number;
  recommendedConfidenceFloor: number;
  recommendedKellyFraction: number;
  learningProfile: LearningProfile;
}

export interface LearningLoopOptions {
  currentEdgeThreshold?: number;
  currentConfidenceFloor?: number;
  currentKellyFraction?: number;
  persist?: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function getCategory(trade: SettledTrade): string {
  return trade.category ?? "__uncategorized__";
}

function computeCategorySignals(
  trades: SettledTrade[]
): LearningCategorySignal[] {
  const byCategory = new Map<string, SettledTrade[]>();
  for (const trade of trades) {
    const category = getCategory(trade);
    const existing = byCategory.get(category) ?? [];
    existing.push(trade);
    byCategory.set(category, existing);
  }

  return Array.from(byCategory.entries()).map(([category, categoryTrades]) => {
    const pnls = categoryTrades.map(trade =>
      trade.side === "buy"
        ? (trade.sizeUsd / trade.entryPrice) * trade.resolvedProbability -
          trade.sizeUsd
        : trade.sizeUsd -
          (trade.sizeUsd / trade.entryPrice) * trade.resolvedProbability
    );
    const wins = pnls.filter(pnl => pnl > 0).length;
    const losses = pnls.filter(pnl => pnl < 0).length;
    const sampleSize = categoryTrades.length;
    const priorProbability = clamp((wins + 1) / (sampleSize + 2), 0.01, 0.99);

    return {
      category,
      wins,
      losses,
      winRate: sampleSize > 0 ? wins / sampleSize : 0,
      priorProbability,
      sampleSize,
    };
  });
}

function computeLearningProfile(
  performance: ReturnType<typeof summarizePerformance>,
  hiddenEdgeHitRate: number,
  categorySignals: LearningCategorySignal[]
): LearningProfile {
  const weightedCategoryPrior =
    categorySignals.length === 0
      ? undefined
      : categorySignals.reduce(
          (sum, signal) => sum + signal.priorProbability * signal.sampleSize,
          0
        ) / categorySignals.reduce((sum, signal) => sum + signal.sampleSize, 0);

  return {
    categoryPrior: weightedCategoryPrior,
    hiddenEdgeHitRate,
    brierScore: performance.brierScore,
  };
}

export function deriveLearningSignals(
  trades: SettledTrade[]
): LearningLoopSignal {
  const performance = summarizePerformance(trades);
  const hiddenEdgeHitRate = performance.hiddenEdgeHitRate;
  const hiddenEdgePnlUsd = performance.hiddenEdgePnlUsd;
  const categorySignals = computeCategorySignals(trades);

  const recommendedEdgeThreshold = clamp(
    0.05 +
      Math.max(0, performance.brierScore - 0.15) * 0.08 +
      Math.max(0, 0.45 - performance.winRate) * 0.04 -
      Math.max(0, hiddenEdgeHitRate - 0.2) * 0.02,
    0.03,
    0.12
  );
  const recommendedConfidenceFloor = clamp(
    0.7 + Math.max(0, performance.brierScore - 0.15) * 0.6,
    0.7,
    0.9
  );
  const recommendedKellyFraction = clamp(
    0.25 * (1 - Math.max(0, performance.brierScore - 0.15)),
    0.1,
    0.3
  );

  return {
    performance,
    hiddenEdgeHitRate,
    hiddenEdgePnlUsd,
    categorySignals,
    recommendedEdgeThreshold,
    recommendedConfidenceFloor,
    recommendedKellyFraction,
    learningProfile: computeLearningProfile(
      performance,
      hiddenEdgeHitRate,
      categorySignals
    ),
  };
}

export async function persistLearningSignals(
  signals: LearningLoopSignal,
  options: LearningLoopOptions = {}
): Promise<void> {
  const persist = options.persist ?? true;
  if (!persist) return;

  for (const signal of signals.categorySignals) {
    const prior: InsertBayesianPrior = {
      category: signal.category,
      priorProbability: signal.priorProbability.toString(),
      sampleSize: signal.sampleSize,
    };
    await upsertBayesianPrior(prior);
  }

  await updateBotConfig({
    edgeThreshold: signals.recommendedEdgeThreshold.toString(),
    minConfidence: signals.recommendedConfidenceFloor.toString(),
    kellyFraction: signals.recommendedKellyFraction.toString(),
  });
}

export async function learnFromSettledTrades(
  trades: SettledTrade[],
  options: LearningLoopOptions = {}
): Promise<LearningLoopSignal> {
  const signals = deriveLearningSignals(trades);
  if (options.persist ?? true) {
    await persistLearningSignals(signals, options);
  }
  return signals;
}
