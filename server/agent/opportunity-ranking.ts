import type { DeepEdgeDecision } from "./deep-edge-gate";
import { scoreOpportunity } from "./market-selection";
import type { SimilarHistoricalEvent } from "../memory/vector-retrieval";
import type { AgentMarket, EnsembleDecision, RiskDecision } from "./types";

export interface LearningProfile {
  categoryPrior?: number;
  hiddenEdgeHitRate?: number;
  brierScore?: number;
}

export interface OpportunityRankingInput {
  market: AgentMarket;
  ensemble: EnsembleDecision;
  risk: RiskDecision;
  deepEdge: DeepEdgeDecision;
  memoryMatches: SimilarHistoricalEvent[];
  learningProfile?: LearningProfile;
  now?: Date;
}

export interface OpportunityRanking {
  rank: number;
  expectedValueUsd: number;
  nonObviousnessScore: number;
  memorySignal: number;
  calibrationPenalty: number;
  hiddenEdgeBonus: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

function averageTopSimilarity(matches: SimilarHistoricalEvent[]): number {
  if (matches.length === 0) return 0;
  const top = matches
    .slice()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
  return top.reduce((sum, match) => sum + match.similarity, 0) / top.length;
}

function computeExpectedValueUsd(
  market: AgentMarket,
  ensemble: EnsembleDecision,
  risk: RiskDecision
): number {
  if (!risk.intent) return 0;
  const sizeUsd = risk.intent.sizeUsd;
  const price = Math.max(0.01, Math.min(0.99, risk.intent.limitPrice));
  const probability = clamp01(ensemble.estimatedProbability);

  if (risk.intent.side === "buy") {
    return sizeUsd * ((probability - price) / price);
  }

  return sizeUsd * ((price - probability) / (1 - price));
}

export function rankOpportunity(
  input: OpportunityRankingInput
): OpportunityRanking {
  const { market, ensemble, risk, deepEdge, memoryMatches, learningProfile } =
    input;
  const selection = scoreOpportunity(
    market,
    risk,
    undefined,
    input.now,
    ensemble
  );
  const expectedValueUsd = computeExpectedValueUsd(market, ensemble, risk);
  const memorySignal = averageTopSimilarity(memoryMatches);
  const nonObviousnessScore =
    deepEdge.anomaly.totalScore * 0.45 +
    (deepEdge.reasoning?.confidence ?? 0) * 0.35 +
    memorySignal * 0.2;
  const calibrationPenalty = clamp01(
    (learningProfile?.brierScore ?? 0.18) / 0.3
  );
  const hiddenEdgeBonus =
    learningProfile?.hiddenEdgeHitRate == null
      ? 0.5
      : clamp01(learningProfile.hiddenEdgeHitRate / 0.2);
  const categoryPrior = clamp01(learningProfile?.categoryPrior ?? 0.5);

  const rank =
    expectedValueUsd * 100 +
    selection.total * 60 +
    nonObviousnessScore * 20 +
    memorySignal * 10 +
    hiddenEdgeBonus * 8 +
    categoryPrior * 5 -
    calibrationPenalty * 15;

  return {
    rank,
    expectedValueUsd,
    nonObviousnessScore,
    memorySignal,
    calibrationPenalty,
    hiddenEdgeBonus,
  };
}
