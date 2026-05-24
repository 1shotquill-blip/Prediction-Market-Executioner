import { describe, expect, it } from "vitest";
import {
  DEFAULT_RISK_LIMITS,
  computeBinaryKellyFraction,
  evaluateRisk,
} from "./risk-manager";
import type { AgentMarket, EnsembleDecision, PortfolioSnapshot } from "./types";

const freshMarket: AgentMarket = {
  marketId: "market-1",
  question: "Will the event happen?",
  yesTokenId: "yes-token",
  noTokenId: "no-token",
  bestBid: 0.52,
  bestAsk: 0.54,
  spread: 0.02,
  midpoint: 0.53,
  volume24h: 50000,
  liquidity: 10000,
  expiresAt: new Date(Date.now() + 86_400_000),
  orderbookUpdatedAt: new Date(),
  category: "politics",
};

const ensemble: EnsembleDecision = {
  marketId: "market-1",
  outcome: "yes",
  estimatedProbability: 0.64,
  confidence: 0.8,
  estimates: [],
  modelDisagreement: 0.05,
  evidenceSummary: ["base rate and fresh evidence support YES"],
  generatedAt: new Date(),
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

describe("production risk manager", () => {
  it("uses binary market price in Kelly sizing", () => {
    expect(computeBinaryKellyFraction(0.64, 0.54)).toBeGreaterThan(0);
    expect(computeBinaryKellyFraction(0.5, 0.54)).toBe(0);
  });

  it("allows a trade only when every hard gate passes", () => {
    const decision = evaluateRisk(
      freshMarket,
      ensemble,
      cleanPortfolio,
      DEFAULT_RISK_LIMITS
    );
    expect(decision.allowed).toBe(true);
    expect(decision.intent?.side).toBe("buy");
    expect(decision.intent?.limitPrice).toBe(freshMarket.bestAsk);
    expect(decision.diagnostics.executionMultiplier).toBeGreaterThan(0);
  });

  it("blocks stale orderbooks", () => {
    const staleMarket = {
      ...freshMarket,
      orderbookUpdatedAt: new Date(Date.now() - 30_000),
    };
    const decision = evaluateRisk(
      staleMarket,
      ensemble,
      cleanPortfolio,
      DEFAULT_RISK_LIMITS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("market data is stale");
  });

  it("blocks trades when reconciliation is unknown", () => {
    const decision = evaluateRisk(
      freshMarket,
      ensemble,
      { ...cleanPortfolio, reconciliationStatus: "unknown" },
      DEFAULT_RISK_LIMITS
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain("portfolio reconciliation is not clean");
  });

  it("blocks when confidence is too low even if edge is positive", () => {
    const decision = evaluateRisk(
      freshMarket,
      { ...ensemble, confidence: 0.4 },
      cleanPortfolio,
      DEFAULT_RISK_LIMITS
    );
    expect(decision.allowed).toBe(false);
    expect(
      decision.reasons.some(reason => reason.startsWith("confidence"))
    ).toBe(true);
  });

  it("sizes faster-resolving markets more aggressively", () => {
    const fastMarket = {
      ...freshMarket,
      expiresAt: new Date(Date.now() + 12 * 3_600_000),
    };
    const slowMarket = {
      ...freshMarket,
      expiresAt: new Date(Date.now() + 72 * 3_600_000),
    };

    const relaxedLimits = {
      ...DEFAULT_RISK_LIMITS,
      maxSingleMarketExposurePct: 10,
      maxCategoryExposurePct: 20,
      maxTotalExposurePct: 20,
      maxOrderSizeUsd: 1_000,
    };

    const fastDecision = evaluateRisk(
      fastMarket,
      ensemble,
      cleanPortfolio,
      relaxedLimits
    );
    const slowDecision = evaluateRisk(
      slowMarket,
      ensemble,
      cleanPortfolio,
      relaxedLimits
    );

    expect(fastDecision.intent?.sizeUsd ?? 0).toBeGreaterThan(
      slowDecision.intent?.sizeUsd ?? 0
    );
    expect(fastDecision.diagnostics.resolutionSpeedMultiplier).toBeGreaterThan(
      slowDecision.diagnostics.resolutionSpeedMultiplier ?? 0
    );
  });
});
