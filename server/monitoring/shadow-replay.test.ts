import { describe, expect, it } from "vitest";
import type { DecisionAudit } from "../../drizzle/schema";
import { replayDecisionAudit, summarizeShadowReplay } from "./shadow-replay";

const replayableAudit = {
  id: 1,
  tickId: "tick-1",
  marketId: "market-1",
  question: "Will the edge hit?",
  action: "paper_order_submitted",
  reasons: [],
  edge: "0.08",
  confidence: "0.85",
  diagnostics: {
    risk: {
      allowed: true,
      intent: { confidence: 0.85 },
      diagnostics: { selectedEdge: 0.08 },
    },
    ensemble: { confidence: 0.85 },
    deepEdge: {
      allowed: true,
      anomaly: { totalScore: 0.82 },
      reasoning: {
        confidence: 0.9,
        expectedCorrectionPct: 12,
      },
    },
    selectionScore: { total: 0.4 },
  },
} as unknown as DecisionAudit;

describe("shadow replay", () => {
  it("replays a complete audit into a trade-thesis classification", () => {
    const sample = replayDecisionAudit(replayableAudit);

    expect(sample.replayable).toBe(true);
    expect(sample.wouldTrade).toBe(true);
    expect(sample.selectedEdge).toBeCloseTo(0.08);
    expect(sample.deepConfidence).toBeCloseTo(0.9);
  });

  it("summarizes replay coverage and eligibility", () => {
    const summary = summarizeShadowReplay([
      replayableAudit,
      {
        ...replayableAudit,
        id: 2,
        action: "skipped",
        diagnostics: {
          risk: {
            allowed: false,
            diagnostics: { selectedEdge: 0.01 },
          },
        },
      } as unknown as DecisionAudit,
    ]);

    expect(summary.totalAudits).toBe(2);
    expect(summary.replayableAudits).toBe(1);
    expect(summary.wouldTradeAudits).toBe(1);
    expect(summary.executedAudits).toBe(1);
  });
});
