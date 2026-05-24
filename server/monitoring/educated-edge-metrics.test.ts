import { describe, expect, it } from "vitest";
import { EducatedEdgeMetricsTracker } from "./educated-edge-metrics";

describe("educated edge metrics", () => {
  it("tracks invisible edge ratio and hidden-edge profitability", () => {
    const tracker = new EducatedEdgeMetricsTracker();
    tracker.recordTrade({
      tradeId: "hidden-win",
      openedAt: new Date("2026-01-01T00:00:00Z"),
      hiddenEdge: true,
      pnlUsd: 12,
    });
    tracker.recordTrade({
      tradeId: "threshold-loss",
      openedAt: new Date("2026-01-02T00:00:00Z"),
      hiddenEdge: false,
      pnlUsd: -3,
    });

    const summary = tracker.summarize(new Date("2026-01-31T00:00:00Z"));

    expect(summary.invisibleEdgeRatio).toBe(0.5);
    expect(summary.hiddenEdgeHitRate).toBe(1);
    expect(summary.hiddenEdgePnlUsd).toBe(12);
    expect(summary.totalPnlUsd).toBe(9);
  });
});
