import { describe, expect, it, vi } from "vitest";
import { RuleBasedIntelligenceEngine } from "./intelligence";
import { AgentOrchestrator } from "./orchestrator";
import { PaperExecutionAdapter } from "./paper-execution";
import { StaticDeepEdgeGate } from "./deep-edge-gate";
import type { AgentMarket, PortfolioSnapshot } from "./types";

vi.mock("./order-persistence", () => ({
  persistPaperOrderIntent: vi.fn(),
  persistLifecycleUpdate: vi.fn(),
}));

const market: AgentMarket = {
  marketId: "market-1",
  question: "Will this happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.5,
  bestAsk: 0.52,
  spread: 0.02,
  midpoint: 0.51,
  volume24h: 50000,
  liquidity: 10000,
  expiresAt: new Date(Date.now() + 86_400_000),
  orderbookUpdatedAt: new Date("2026-01-01T00:00:00Z"),
  category: "politics",
};

const cleanPortfolio: PortfolioSnapshot = {
  bankrollUsd: 1000,
  peakBankrollUsd: 1000,
  openExposureUsd: 0,
  dailyPnlUsd: 0,
  marketExposureUsd: {},
  categoryExposureUsd: {},
  openOrderCount: 0,
  reconciliationStatus: "ok",
};

const passingDeepEdgeGate = new StaticDeepEdgeGate({
  allowed: true,
  anomaly: {
    marketId: "market-1",
    totalScore: 0.82,
    anomalyType: "divergence",
    generatedAt: new Date("2026-01-01T00:00:00Z"),
    components: {
      crossMarket: { score: 0.7, reason: "peer dislocation" },
      temporal: { score: 0.7, reason: "temporal dislocation" },
      divergence: { score: 0.95, reason: "large model-market gap" },
      whale: { score: 0.75, reason: "pressure anomaly" },
    },
  },
  reasoning: {
    marketId: "market-1",
    confidence: 0.86,
    fairPriceRange: { low: 0.62, high: 0.74 },
    expectedCorrectionPct: 12,
    contrarianHypothesis: "The market is ignoring a non-obvious catalyst.",
    steelmanCurrentPrice: "The current price assumes base rates dominate.",
    steelmanRebuttal: "The base-rate argument omits current evidence.",
    identifiedBlindSpot: "The crowd is underweighting catalyst timing.",
    catalyst: {
      description: "Public confirmation reprices the market.",
      expectedAt: new Date("2026-01-02T00:00:00Z"),
      expectedMovePct: 12,
    },
    memoryMatches: [],
    generatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  memoryMatches: [],
});

describe("agent orchestrator", () => {
  it("submits a paper order only after intelligence and risk pass", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.65,
          confidence: 0.85,
          evidence: ["strong test signal"],
        },
      ]),
      execution: new PaperExecutionAdapter(),
      deepEdgeGate: passingDeepEdgeGate,
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(1);
    expect(result.audits[0]?.action).toBe("paper_order_submitted");
    expect(result.audits[0]?.lifecycleUpdate?.status).toBe("filled");
  });

  it("skips when no high-confidence intelligence decision exists", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine(),
      deepEdgeGate: passingDeepEdgeGate,
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(0);
    expect(result.audits[0]?.reasons).toContain(
      "no high-confidence ensemble decision"
    );
  });

  it("skips all markets when reconciliation is not clean", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: {
        snapshot: async () => ({
          ...cleanPortfolio,
          reconciliationStatus: "mismatch",
        }),
      },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.8,
          confidence: 0.9,
          evidence: ["would otherwise pass"],
        },
      ]),
      deepEdgeGate: passingDeepEdgeGate,
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(0);
    expect(result.audits[0]?.reasons).toContain(
      "portfolio reconciliation is not clean"
    );
  });

  it("selects the highest-scoring opportunity when order slots are limited", async () => {
    const betterMarket = {
      ...market,
      marketId: "market-2",
      yesTokenId: "yes-token-2",
      bestBid: 0.49,
      bestAsk: 0.5,
      spread: 0.01,
      midpoint: 0.495,
      liquidity: 50000,
    };
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market, betterMarket] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.62,
          confidence: 0.75,
          evidence: ["ok signal"],
        },
        {
          marketId: "market-2",
          probability: 0.7,
          confidence: 0.9,
          evidence: ["better signal"],
        },
      ]),
      execution: new PaperExecutionAdapter(),
      deepEdgeGate: passingDeepEdgeGate,
      maxOrdersPerTick: 1,
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(1);
    expect(
      result.audits.find(audit => audit.action === "paper_order_submitted")
        ?.marketId
    ).toBe("market-2");
    expect(
      result.audits.find(audit => audit.marketId === "market-1")?.reasons
    ).toContain("not selected for this tick");
  });

  it("blocks approved risk when the anomaly gate does not pass", async () => {
    const orchestrator = new AgentOrchestrator({
      marketProvider: { scan: async () => [market] },
      portfolioProvider: { snapshot: async () => cleanPortfolio },
      intelligence: new RuleBasedIntelligenceEngine([
        {
          marketId: "market-1",
          probability: 0.65,
          confidence: 0.85,
          evidence: ["strong test signal"],
        },
      ]),
      deepEdgeGate: new StaticDeepEdgeGate({
        allowed: false,
        anomaly: {
          marketId: "market-1",
          totalScore: 0.2,
          anomalyType: "divergence",
          generatedAt: new Date("2026-01-01T00:00:00Z"),
          components: {
            crossMarket: { score: 0, reason: "none" },
            temporal: { score: 0, reason: "none" },
            divergence: { score: 0.2, reason: "small gap" },
            whale: { score: 0, reason: "none" },
          },
        },
        memoryMatches: [],
      }),
      persistOrders: false,
    });

    const result = await orchestrator.tick(new Date("2026-01-01T00:00:00Z"));

    expect(result.submittedOrders).toBe(0);
    expect(result.audits[0]?.reasons).toContain("static deep edge rejection");
  });
});
