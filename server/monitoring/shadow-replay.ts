import type { DecisionAudit } from "../../drizzle/schema";

export interface ShadowReplaySample {
  auditId: number;
  tickId: string;
  marketId: string;
  action: string;
  replayable: boolean;
  wouldTrade: boolean;
  selectedEdge: number;
  confidence: number;
  anomalyScore: number;
  deepConfidence: number;
  expectedCorrectionPct: number;
  reasons: string[];
}

export interface ShadowReplaySummary {
  totalAudits: number;
  replayableAudits: number;
  wouldTradeAudits: number;
  executedAudits: number;
  skippedAudits: number;
  averageSelectedEdge: number;
  averageConfidence: number;
  averageAnomalyScore: number;
  averageDeepConfidence: number;
  shadowConversionRate: number;
  shadowWinRate: number;
  samples: ShadowReplaySample[];
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as Record<string, unknown>;
}

function getNestedRecord(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return getRecord(value);
}

export function replayDecisionAudit(audit: DecisionAudit): ShadowReplaySample {
  const diagnostics = getRecord(audit.diagnostics);
  const risk = getNestedRecord(diagnostics, "risk");
  const ensemble = getNestedRecord(diagnostics, "ensemble");
  const deepEdge = getNestedRecord(diagnostics, "deepEdge");
  const reasons = Array.isArray(audit.reasons)
    ? audit.reasons.map(reason => String(reason))
    : [];

  const selectedEdge = asNumber(
    risk?.diagnostics && typeof risk.diagnostics === "object"
      ? (risk.diagnostics as Record<string, unknown>).selectedEdge
      : (audit.edge ?? 0)
  );
  const confidence = asNumber(
    risk?.intent && typeof risk.intent === "object"
      ? (risk.intent as Record<string, unknown>).confidence
      : (audit.confidence ?? 0)
  );
  const anomalyRecord = getNestedRecord(deepEdge, "anomaly");
  const reasoningRecord = getNestedRecord(deepEdge, "reasoning");
  const anomalyScore = asNumber(anomalyRecord?.totalScore);
  const deepConfidence = asNumber(reasoningRecord?.confidence);
  const expectedCorrectionPct = asNumber(
    reasoningRecord?.expectedCorrectionPct
  );

  const replayable =
    Boolean(risk) &&
    Boolean(ensemble) &&
    Boolean(deepEdge) &&
    selectedEdge > 0 &&
    confidence > 0;
  const wouldTrade =
    replayable &&
    Boolean(risk?.allowed) &&
    Boolean(deepEdge?.allowed) &&
    Boolean(risk?.intent) &&
    selectedEdge >= 0.06 &&
    confidence >= 0.7 &&
    deepConfidence >= 0.8 &&
    expectedCorrectionPct >= 10;

  return {
    auditId: audit.id,
    tickId: audit.tickId,
    marketId: audit.marketId,
    action: audit.action,
    replayable,
    wouldTrade,
    selectedEdge,
    confidence,
    anomalyScore,
    deepConfidence,
    expectedCorrectionPct,
    reasons,
  };
}

export function summarizeShadowReplay(
  audits: DecisionAudit[]
): ShadowReplaySummary {
  const samples = audits.map(replayDecisionAudit);
  const totalAudits = samples.length;
  const replayableAudits = samples.filter(sample => sample.replayable).length;
  const wouldTradeAudits = samples.filter(sample => sample.wouldTrade).length;
  const executedAudits = samples.filter(
    sample =>
      sample.action === "paper_order_submitted" ||
      sample.action === "live_order_submitted"
  ).length;
  const skippedAudits = samples.filter(
    sample => sample.action === "skipped"
  ).length;
  const averageSelectedEdge =
    totalAudits > 0
      ? samples.reduce((sum, sample) => sum + sample.selectedEdge, 0) /
        totalAudits
      : 0;
  const averageConfidence =
    totalAudits > 0
      ? samples.reduce((sum, sample) => sum + sample.confidence, 0) /
        totalAudits
      : 0;
  const averageAnomalyScore =
    totalAudits > 0
      ? samples.reduce((sum, sample) => sum + sample.anomalyScore, 0) /
        totalAudits
      : 0;
  const averageDeepConfidence =
    totalAudits > 0
      ? samples.reduce((sum, sample) => sum + sample.deepConfidence, 0) /
        totalAudits
      : 0;
  const shadowConversionRate =
    replayableAudits > 0 ? wouldTradeAudits / replayableAudits : 0;
  const shadowWinRate =
    executedAudits > 0 ? wouldTradeAudits / executedAudits : 0;

  return {
    totalAudits,
    replayableAudits,
    wouldTradeAudits,
    executedAudits,
    skippedAudits,
    averageSelectedEdge,
    averageConfidence,
    averageAnomalyScore,
    averageDeepConfidence,
    shadowConversionRate,
    shadowWinRate,
    samples,
  };
}
