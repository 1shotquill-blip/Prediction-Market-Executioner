import { ENV } from "../_core/env";
import { getClobReferencePrice } from "./book-pricing";
import {
  scanMarketAnomalies,
  type AnomalyScanResult,
  type AnomalyScannerContext,
} from "../intelligence/anomaly-scanner";
import {
  DeepReasoner,
  OllamaDeepReasoningProvider,
  type DeepReasoningResult,
} from "../intelligence/deep-reasoner";
import {
  buildStructuralEmbedding,
  type VectorMemoryStore,
  type SimilarHistoricalEvent,
} from "../memory/vector-retrieval";
import type { AgentMarket, EnsembleDecision } from "./types";

export interface DeepEdgeLimits {
  minAnomalyScore: number;
  minDeepConfidence: number;
  minExpectedCorrectionPct: number;
  catalystTimeoutMultiplier: number;
}

export const DEFAULT_DEEP_EDGE_LIMITS: DeepEdgeLimits = {
  minAnomalyScore: Number.isFinite(ENV.deepEdgeMinScore)
    ? ENV.deepEdgeMinScore
    : 0.7,
  minDeepConfidence: Number.isFinite(ENV.deepEdgeMinConfidence)
    ? ENV.deepEdgeMinConfidence
    : 0.8,
  minExpectedCorrectionPct: 10,
  catalystTimeoutMultiplier: Number.isFinite(ENV.catalystTimeoutMultiplier)
    ? ENV.catalystTimeoutMultiplier
    : 1.5,
};

export interface DeepEdgeDecision {
  allowed: boolean;
  reasons: string[];
  anomaly: AnomalyScanResult;
  reasoning?: DeepReasoningResult;
  memoryMatches: SimilarHistoricalEvent[];
}

export interface DeepEdgeGate {
  evaluate(
    market: AgentMarket,
    decision: EnsembleDecision,
    context: AnomalyScannerContext,
    now?: Date
  ): Promise<DeepEdgeDecision>;
}

export class ProductionDeepEdgeGate implements DeepEdgeGate {
  constructor(
    private readonly options: {
      reasoner?: DeepReasoner;
      memoryStore?: VectorMemoryStore;
      limits?: DeepEdgeLimits;
    } = {}
  ) {}

  async evaluate(
    market: AgentMarket,
    decision: EnsembleDecision,
    context: AnomalyScannerContext = {},
    now = new Date()
  ): Promise<DeepEdgeDecision> {
    const limits = this.options.limits ?? DEFAULT_DEEP_EDGE_LIMITS;
    const anomaly = scanMarketAnomalies(market, decision, context, now);
    const reasons: string[] = [];

    if (anomaly.totalScore < limits.minAnomalyScore) {
      reasons.push(
        `anomaly score ${anomaly.totalScore.toFixed(4)} below minimum ${limits.minAnomalyScore}`
      );
    }

    const referencePrice = getClobReferencePrice(market);
    const probabilityGap = Number.isFinite(referencePrice)
      ? Math.abs(decision.estimatedProbability - referencePrice)
      : 0;
    const hoursToExpiry =
      (market.expiresAt.getTime() - now.getTime()) / 3_600_000;
    const embedding = buildStructuralEmbedding({
      anomalyScore: anomaly.totalScore,
      probabilityGap,
      liquidity: market.liquidity,
      volume24h: market.volume24h,
      spread: market.spread,
      hoursToExpiry,
    });
    const memoryMatches =
      (await this.options.memoryStore?.searchByEmbedding(embedding, {
        topK: 5,
        anomalyType: anomaly.anomalyType,
      })) ?? [];

    let reasoning: DeepReasoningResult | undefined;
    try {
      const reasoner =
        this.options.reasoner ??
        new DeepReasoner(new OllamaDeepReasoningProvider());
      reasoning =
        (await reasoner.evaluate({
          market,
          decision,
          anomaly,
          memoryMatches,
          now,
        })) ?? undefined;
    } catch (error) {
      reasons.push(`deep reasoner unavailable: ${String(error)}`);
    }

    if (!reasoning) {
      reasons.push("deep reasoner did not produce a complete anomaly thesis");
    } else {
      if (reasoning.confidence < limits.minDeepConfidence) {
        reasons.push(
          `deep reasoner confidence ${reasoning.confidence.toFixed(4)} below minimum ${limits.minDeepConfidence}`
        );
      }
      if (reasoning.expectedCorrectionPct < limits.minExpectedCorrectionPct) {
        reasons.push(
          `expected correction ${reasoning.expectedCorrectionPct.toFixed(2)}% below minimum ${limits.minExpectedCorrectionPct}%`
        );
      }
    }

    return {
      allowed: reasons.length === 0,
      reasons,
      anomaly,
      reasoning,
      memoryMatches,
    };
  }
}

export class StaticDeepEdgeGate implements DeepEdgeGate {
  constructor(private readonly decision: Omit<DeepEdgeDecision, "reasons">) {}

  async evaluate(): Promise<DeepEdgeDecision> {
    return {
      ...this.decision,
      reasons: this.decision.allowed ? [] : ["static deep edge rejection"],
    };
  }
}
