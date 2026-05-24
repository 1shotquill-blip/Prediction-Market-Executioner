import { describe, expect, it, vi, beforeEach } from "vitest";
import { collectOperationalHealthSnapshot } from "./operational-health";

const getBotConfig = vi.fn();
const getEquityHistory = vi.fn();
const getLatestEquitySnapshot = vi.fn();
const getOpenOrders = vi.fn();
const getRecentDecisionAudits = vi.fn();
const getRecentTrades = vi.fn();

vi.mock("../db", () => ({
  getBotConfig: (...args: unknown[]) => getBotConfig(...args),
  getEquityHistory: (...args: unknown[]) => getEquityHistory(...args),
  getLatestEquitySnapshot: (...args: unknown[]) =>
    getLatestEquitySnapshot(...args),
  getOpenOrders: (...args: unknown[]) => getOpenOrders(...args),
  getRecentDecisionAudits: (...args: unknown[]) =>
    getRecentDecisionAudits(...args),
  getRecentTrades: (...args: unknown[]) => getRecentTrades(...args),
}));

vi.mock("../exchange/polymarket", () => ({
  getPolymarketLiveReadiness: () => ({
    ready: true,
    missing: [],
    warnings: [],
  }),
}));

describe("operational health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a replay-backed snapshot with stale order detection", async () => {
    getBotConfig.mockResolvedValue({
      isRunning: 1,
      isPaused: 0,
      emergencyBrakeTriggered: 0,
      executionMode: "live",
    });
    getLatestEquitySnapshot.mockResolvedValue({
      balance: "1000",
      peakBalance: "1100",
    });
    getEquityHistory.mockResolvedValue([{ timestamp: new Date() }]);
    getOpenOrders.mockResolvedValue([
      {
        placedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    getRecentDecisionAudits.mockResolvedValue([
      {
        id: 1,
        tickId: "tick-1",
        marketId: "market-1",
        action: "paper_order_submitted",
        reasons: [],
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
        },
      },
    ]);
    getRecentTrades.mockResolvedValue([
      {
        id: 7,
        marketId: "market-1",
        side: "buy",
        price: "0.50",
        size: "20",
        usdcValue: "10",
      },
    ]);

    const snapshot = await collectOperationalHealthSnapshot(
      new Date("2026-01-01T00:10:00Z")
    );

    expect(snapshot.ok).toBe(false);
    expect(snapshot.staleOpenOrderCount).toBe(1);
    expect(snapshot.shadowReplay.wouldTradeAudits).toBe(1);
    expect(snapshot.recentTradeCount).toBe(1);
    expect(snapshot.recentTradeNotionalUsd).toBe(10);
  });
});
