import { getRecentDecisionAudits } from "../../db";
import { ENV } from "../../_core/env";

export interface AlphaReport {
  generatedAt: Date;
  summary: {
    totalScanned: number;
    totalAnalyzed: number;
    highConfidenceTrades: number;
  };
  alphaSignals: any[];
}

export async function generateAlphaReport(
  lookbackHours = 24
): Promise<AlphaReport> {
  const audits = await getRecentDecisionAudits(500); // Fetch rich decision data

  // High-value filter for alpha signals: confidence > 0.85 and edge > 0.10
  const alphaSignals = audits
    .filter(a => a.risk?.intent?.confidence && a.risk.intent.confidence > 0.85)
    .filter(a => a.risk?.intent?.edge && a.risk.intent.edge > 0.1)
    .map(a => ({
      market: a.market?.question,
      edge: a.risk?.intent?.edge,
      confidence: a.risk?.intent?.confidence,
      rationale: a.risk?.intent?.rationale,
    }));

  return {
    generatedAt: new Date(),
    summary: {
      totalScanned: audits.length,
      totalAnalyzed: audits.length,
      highConfidenceTrades: alphaSignals.length,
    },
    alphaSignals,
  };
}
