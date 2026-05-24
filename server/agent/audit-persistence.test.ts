import { describe, expect, it, vi } from "vitest";
import {
  createTickId,
  mapDecisionAuditToInsert,
  persistDecisionAudits,
} from "./audit-persistence";
import type { AgentDecisionAudit } from "./orchestrator";

vi.mock("../db", () => ({
  insertDecisionAudits: vi.fn(),
}));

const audit: AgentDecisionAudit = {
  marketId: "market-1",
  question: "Will this happen?",
  market: {
    marketId: "market-1",
    question: "Will this happen?",
    yesTokenId: "yes-token",
    noTokenId: "no-token",
    bestBid: 0.5,
    bestAsk: 0.52,
    spread: 0.02,
    midpoint: 0.51,
    volume24h: 10000,
    liquidity: 5000,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
    orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  action: "paper_order_submitted",
  reasons: [],
  risk: {
    allowed: true,
    reasons: [],
    intent: {
      marketId: "market-1",
      tokenId: "yes-token",
      outcome: "yes",
      side: "buy",
      limitPrice: 0.52,
      sizeUsd: 50,
      edge: 0.08,
      estimatedProbability: 0.6,
      confidence: 0.8,
      rationale: ["test"],
    },
    diagnostics: {
      buyEdge: 0.08,
      sellEdge: -0.1,
      selectedEdge: 0.08,
      kellyFraction: 0.01,
      cappedSizeUsd: 50,
      drawdownPct: 0,
      marketDataStatus: "fresh",
    },
  },
  receipt: {
    localOrderId: "paper-1",
    exchangeOrderId: "paper-exchange-1",
    status: "paper_accepted",
    submittedAt: new Date("2026-01-01T00:00:00Z"),
  },
  lifecycleUpdate: {
    localOrderId: "paper-1",
    exchangeOrderId: "paper-exchange-1",
    status: "filled",
    matchedSizeUsd: 50,
    remainingSizeUsd: 0,
    updatedAt: new Date("2026-01-01T00:00:01Z"),
  },
  selectionScore: {
    total: 0.75,
    edgeScore: 0.4,
    confidenceScore: 0.8,
    liquidityScore: 0.9,
    timeRemainingScore: 1,
  },
};

describe("decision audit persistence", () => {
  it("creates stable tick ids", () => {
    expect(createTickId(new Date("2026-01-01T00:00:00Z"))).toMatch(
      /^tick-1767225600000-/
    );
  });

  it("maps orchestrator audits into DB insert shape", () => {
    const insert = mapDecisionAuditToInsert("tick-1", audit);

    expect(insert).toMatchObject({
      tickId: "tick-1",
      marketId: "market-1",
      action: "paper_order_submitted",
      estimatedProbability: "0.6",
      confidence: "0.8",
      edge: "0.08",
      bestBid: "0.5",
      bestAsk: "0.52",
      spread: "0.02",
      selectionScore: "0.75",
      orderNonce: "paper-1",
      exchangeOrderId: "paper-exchange-1",
      lifecycleStatus: "filled",
    });
  });

  it("persists all mapped audits", async () => {
    const db = await import("../db");

    await persistDecisionAudits("tick-1", [audit]);

    expect(db.insertDecisionAudits).toHaveBeenCalledWith([
      expect.objectContaining({ tickId: "tick-1" }),
    ]);
  });
});
