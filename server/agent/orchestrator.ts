import {
  DEFAULT_RISK_LIMITS,
  evaluateKalshiMicroBankrollRisk,
  evaluateRisk,
  type KalshiRiskLimits,
} from "./risk-manager";
import { PaperExecutionAdapter } from "./paper-execution";
import { createTickId, persistDecisionAudits } from "./audit-persistence";
import {
  scoreOpportunity,
  type MarketSelectionScore,
} from "./market-selection";
import {
  rankOpportunity,
  type OpportunityRanking,
  type LearningProfile,
} from "./opportunity-ranking";
import {
  persistAcceptedOrderReceipt,
  persistLifecycleUpdate,
  persistPreExecutionOrderIntent,
} from "./order-persistence";
import {
  ProductionDeepEdgeGate,
  type DeepEdgeDecision,
  type DeepEdgeGate,
} from "./deep-edge-gate";
import { getBayesianPrior } from "../db";
import { ENV } from "../_core/env";
import type {
  AgentMarket,
  EnsembleDecision,
  ExecutionReceipt,
  PortfolioSnapshot,
  RiskDecision,
  RiskLimits,
} from "./types";
import type { IntelligenceEngine } from "./intelligence";
import type {
  ExecutionAdapter,
  OrderLifecycleUpdate,
} from "./execution-adapter";
import { nanoid } from "nanoid";

export interface MarketProvider {
  scan(now?: Date): Promise<AgentMarket[]>;
}

export interface PortfolioProvider {
  snapshot(now?: Date): Promise<PortfolioSnapshot>;
}

function currentKalshiRiskLimits(): KalshiRiskLimits {
  return {
    maxPositionUsd: ENV.kalshiMaxPositionUsd,
    absoluteMaxPositionUsd: ENV.kalshiAbsoluteMaxPositionUsd,
    maxTotalExposureUsd: ENV.kalshiMaxTotalExposureUsd,
    maxDailyLossUsd: ENV.kalshiMaxDailyLossUsd,
    minBankrollReserveUsd: ENV.kalshiMinBankrollReserveUsd,
    maxDaysToResolution: ENV.kalshiAllowedMaxDaysToResolution,
    preferredHoursMin: ENV.kalshiPreferredHoursMin,
    preferredHoursMax: ENV.kalshiPreferredHoursMax,
  };
}

export interface AgentDecisionAudit {
  marketId: string;
  question: string;
  market?: AgentMarket;
  action: "skipped" | "paper_order_submitted" | "live_order_submitted";
  reasons: string[];
  risk?: RiskDecision;
  ensemble?: EnsembleDecision;
  deepEdge?: DeepEdgeDecision;
  selectionScore?: MarketSelectionScore;
  ranking?: OpportunityRanking;
  receipt?: ExecutionReceipt;
  lifecycleUpdate?: OrderLifecycleUpdate;
}

export interface AgentTickResult {
  scannedMarkets: number;
  submittedOrders: number;
  skippedMarkets: number;
  audits: AgentDecisionAudit[];
}

export interface AgentOrchestratorOptions {
  marketProvider: MarketProvider;
  portfolioProvider: PortfolioProvider;
  intelligence: IntelligenceEngine;
  execution?: ExecutionAdapter;
  riskLimits?: RiskLimits;
  deepEdgeGate?: DeepEdgeGate;
  maxOrdersPerTick?: number;
  persistOrders?: boolean;
  persistAudits?: boolean;
  learningProfile?: LearningProfile;
}

export class AgentOrchestrator {
  private readonly marketProvider: MarketProvider;
  private readonly portfolioProvider: PortfolioProvider;
  private readonly intelligence: IntelligenceEngine;
  private readonly execution: ExecutionAdapter;
  private readonly riskLimits: RiskLimits;
  private readonly deepEdgeGate: DeepEdgeGate;
  private readonly maxOrdersPerTick: number;
  private readonly persistOrders: boolean;
  private readonly persistAudits: boolean;
  private readonly learningProfile?: LearningProfile;

  constructor(options: AgentOrchestratorOptions) {
    this.marketProvider = options.marketProvider;
    this.portfolioProvider = options.portfolioProvider;
    this.intelligence = options.intelligence;
    this.execution = options.execution ?? new PaperExecutionAdapter();
    this.riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
    this.deepEdgeGate = options.deepEdgeGate ?? new ProductionDeepEdgeGate();
    this.maxOrdersPerTick = options.maxOrdersPerTick ?? 1;
    this.persistOrders = options.persistOrders ?? true;
    this.persistAudits = options.persistAudits ?? true;
    this.learningProfile = options.learningProfile;
  }

  async tick(now = new Date()): Promise<AgentTickResult> {
    const tickId = createTickId(now);
    // Re-read runtime-tunable limits from ENV so operator changes apply next tick.
    const riskLimits: RiskLimits = {
      ...this.riskLimits,
      maxOrderSizeUsd:
        ENV.maxPositionUsd > 0
          ? ENV.maxPositionUsd
          : this.riskLimits.maxOrderSizeUsd,
      maxDrawdownPct:
        ENV.maxDrawdownPct > 0
          ? ENV.maxDrawdownPct
          : this.riskLimits.maxDrawdownPct,
    };
    const markets = await this.marketProvider.scan(now);
    const portfolio = await this.portfolioProvider.snapshot(now);
    const audits: AgentDecisionAudit[] = [];
    const executableAudits: AgentDecisionAudit[] = [];

    if (portfolio.reconciliationStatus !== "ok") {
      const audits: AgentDecisionAudit[] = markets.map(market => ({
        marketId: market.marketId,
        question: market.question,
        market,
        action: "skipped",
        reasons: ["portfolio reconciliation is not clean"],
      }));
      if (this.persistAudits) await persistDecisionAudits(tickId, audits);

      return {
        scannedMarkets: markets.length,
        submittedOrders: 0,
        skippedMarkets: markets.length,
        audits,
      };
    }

    for (const market of markets) {
      const ensemble = await this.intelligence.evaluate(market, now);
      if (!ensemble) {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: ["no high-confidence ensemble decision"],
        });
        continue;
      }

      const risk = evaluateRisk(market, ensemble, portfolio, riskLimits, now);
      if (!risk.allowed || !risk.intent) {
        audits.push({
          marketId: market.marketId,
          question: market.question,
          market,
          action: "skipped",
          reasons: risk.reasons,
          risk,
        });
        continue;
      }

      if (market.exchange === "kalshi") {
        const hoursToResolution =
          (market.expiresAt.getTime() - now.getTime()) / 3_600_000;
        const microRisk = evaluateKalshiMicroBankrollRisk(
          {
            sizeUsd: risk.intent.sizeUsd,
            bankrollUsd: portfolio.bankrollUsd,
            currentTotalExposureUsd: portfolio.openExposureUsd,
            dailyLossUsd: Math.max(0, -portfolio.dailyPnlUsd),
            hoursToResolution,
            confidence: risk.intent.confidence,
          },
          currentKalshiRiskLimits()
        );

        if (!microRisk.allowed) {
          audits.push({
            marketId: market.marketId,
            question: market.question,
            market,
            action: "skipped",
            reasons: [
              microRisk.rejectionReason ?? "kalshi_micro_risk_rejected",
            ],
            risk,
          });
          continue;
        }
      }

      executableAudits.push({
        marketId: market.marketId,
        question: market.question,
        market,
        action: "skipped",
        reasons: ["not selected for this tick"],
        ensemble,
        risk,
        deepEdge: await this.evaluateDeepEdgeOrSkip(
          market,
          ensemble,
          markets,
          now
        ),
        selectionScore: scoreOpportunity(market, risk, undefined, now),
      });
    }

    const blockedByDeepEdge = executableAudits.filter(
      audit => !audit.deepEdge?.allowed
    );
    for (const audit of blockedByDeepEdge) {
      audits.push({
        ...audit,
        action: "skipped",
        reasons: audit.deepEdge?.reasons ?? ["deep edge gate rejected trade"],
      });
    }

    const deepEdgeApprovedAudits = executableAudits.filter(
      audit => audit.deepEdge?.allowed
    );

    const rankedAudits = await Promise.all(
      deepEdgeApprovedAudits.map(async audit => ({
        ...audit,
        ranking: rankOpportunity({
          market: audit.market!,
          ensemble: audit.ensemble!,
          risk: audit.risk!,
          deepEdge: audit.deepEdge!,
          memoryMatches: audit.deepEdge?.memoryMatches ?? [],
          learningProfile: {
            ...this.learningProfile,
            categoryPrior: audit.market?.category
              ? Number(
                  (await getBayesianPrior(audit.market.category))
                    ?.priorProbability ?? 0.5
                )
              : this.learningProfile?.categoryPrior,
          },
          now,
        }),
      }))
    );

    rankedAudits.sort(
      (a, b) => (b.ranking?.rank ?? 0) - (a.ranking?.rank ?? 0)
    );
    const selectedAudits = rankedAudits.slice(0, this.maxOrdersPerTick);
    const deferredAudits = rankedAudits.slice(this.maxOrdersPerTick);
    let submittedOrders = 0;

    for (const audit of selectedAudits) {
      if (!audit.risk?.intent || !audit.market) continue;
      const localOrderId =
        audit.risk.intent.clientOrderId ??
        `${audit.market.exchange ?? "order"}-${now.getTime()}-${nanoid(8)}`;
      const intent = { ...audit.risk.intent, clientOrderId: localOrderId };

      if (this.persistOrders) {
        await persistPreExecutionOrderIntent(intent, localOrderId, now);
      }

      const receipt = await this.execution.place(intent, audit.market, now);
      if (this.persistOrders) await persistAcceptedOrderReceipt(receipt);

      const accepted =
        receipt.status === "paper_accepted" ||
        receipt.status === "exchange_accepted";
      if (!accepted) {
        if (this.persistOrders) {
          await persistLifecycleUpdate(
            {
              localOrderId,
              exchangeOrderId: receipt.exchangeOrderId,
              status: "rejected",
              matchedSizeUsd: 0,
              remainingSizeUsd: intent.sizeUsd,
              updatedAt: now,
              reason:
                receipt.rejectionReason ?? "execution adapter rejected order",
            },
            intent.limitPrice
          );
        }
        audits.push({
          ...audit,
          action: "skipped",
          reasons: [
            receipt.rejectionReason ?? "execution adapter rejected order",
          ],
          receipt,
        });
        continue;
      }

      const lifecycleUpdate = await this.execution.sync(
        receipt.localOrderId,
        audit.market,
        now
      );
      if (this.persistOrders)
        await persistLifecycleUpdate(lifecycleUpdate, intent.limitPrice);
      submittedOrders += 1;

      audits.push({
        ...audit,
        action:
          receipt.status === "exchange_accepted"
            ? "live_order_submitted"
            : "paper_order_submitted",
        reasons: [],
        receipt,
        lifecycleUpdate,
      });
    }

    audits.push(...deferredAudits);

    if (this.persistAudits) await persistDecisionAudits(tickId, audits);

    return {
      scannedMarkets: markets.length,
      submittedOrders,
      skippedMarkets: audits.filter(audit => audit.action === "skipped").length,
      audits,
    };
  }

  private async evaluateDeepEdgeOrSkip(
    market: AgentMarket,
    ensemble: EnsembleDecision,
    markets: AgentMarket[],
    now: Date
  ): Promise<DeepEdgeDecision> {
    try {
      const { getWhaleTradesForMarket } = await import(
        "../intelligence/whale-monitor"
      );
      return this.deepEdgeGate.evaluate(
        market,
        ensemble,
        {
          peerMarkets: markets,
          whaleTrades: getWhaleTradesForMarket(market.marketId),
        },
        now
      );
    } catch (err) {
      console.warn(
        `[Orchestrator] DeepEdge evaluation failed for ${market.marketId}, defaulting to block:`,
        err
      );
      return {
        allowed: false,
        reasons: ["deep edge evaluation error"],
        anomaly: {
          marketId: market.marketId,
          totalScore: 0,
          components: {
            crossMarket: { score: 0, reason: "evaluation error" },
            temporal: { score: 0, reason: "evaluation error" },
            divergence: { score: 0, reason: "evaluation error" },
            whale: { score: 0, reason: "evaluation error" },
          },
          anomalyType: "none",
          generatedAt: now,
        },
        memoryMatches: [],
      };
    }
  }
}
