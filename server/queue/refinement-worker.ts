import { Worker } from "bullmq";
import { connection } from "./index";
import {
  getRecentDecisionAudits,
  updateBotConfig,
  getTradesByMarketId,
} from "../db";

export const refinementWorker = new Worker(
  "strategy-refinement",
  async job => {
    if (job.name === "optimize-strategy") {
      console.info("[Refinement] Analyzing strategy performance...");

      // 1. Fetch recent decision history
      const audits = await getRecentDecisionAudits(100);

      // 2. Identify trades that underperformed relative to the LLM's confidence
      const failures = audits.filter(
        a =>
          a.risk?.intent?.edge &&
          a.risk.intent.edge > 0.05 &&
          a.status === "rejected"
      );

      if (failures.length > 5) {
        console.warn(
          `[Refinement] Drift detected: ${failures.length} high-edge failures. Tightening confidence threshold.`
        );

        // 3. Autonomous tuning: Increase confidence threshold by 5%
        await updateBotConfig({
          minConfidence: 0.85, // Aggressively increasing from default
        });
      }
    }
  },
  { connection }
);
