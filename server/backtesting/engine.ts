import { readFile } from "node:fs/promises";
import { PaperExecutionAdapter } from "../agent/paper-execution";
import { ProductionDeepEdgeGate } from "../agent/deep-edge-gate";
import { LLMIntelligenceEngine } from "../agent/intelligence";
import {
  AgentOrchestrator,
  type AgentDecisionAudit,
  type MarketProvider,
  type PortfolioProvider,
} from "../agent/orchestrator";
import { DEFAULT_RISK_LIMITS } from "../agent/risk-manager";
import {
  computeTradePnlUsd,
  summarizePerformance,
  type SettledTrade,
} from "../agent/performance";
import type {
  AgentMarket,
  PortfolioSnapshot,
  RiskLimits,
} from "../agent/types";
import type {
  ExecutionAdapter,
  OrderLifecycleUpdate,
} from "../agent/execution-adapter";
import type { DeepEdgeGate } from "../agent/deep-edge-gate";
import type { IntelligenceEngine } from "../agent/intelligence";

export interface HistoricalMarketFrame {
  timestamp: string | Date;
  markets: AgentMarket[];
  resolvedOutcomes?: Record<string, 0 | 1>;
  label?: string;
}

export interface BacktestEquityPoint {
  timestamp: Date;
  balanceUsd: number;
  peakBalanceUsd: number;
  openExposureUsd: number;
  drawdownPct: number;
}

export interface BacktestRunResult {
  framesProcessed: number;
  audits: AgentDecisionAudit[];
  trades: SettledTrade[];
  equityCurve: BacktestEquityPoint[];
  performance: ReturnType<typeof summarizePerformance>;
  finalBankrollUsd: number;
  openExposureUsd: number;
  unresolvedTradeCount: number;
}

export interface BacktestingEngineOptions {
  initialBankrollUsd?: number;
  intelligence?: IntelligenceEngine;
  deepEdgeGate?: DeepEdgeGate;
  execution?: ExecutionAdapter;
  riskLimits?: Partial<RiskLimits>;
  maxOrdersPerTick?: number;
  persistAudits?: boolean;
}

interface TrackedBacktestTrade {
  trade: SettledTrade;
  resolved: boolean;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeFrame(frame: HistoricalMarketFrame): HistoricalMarketFrame {
  return {
    ...frame,
    timestamp: toDate(frame.timestamp),
    markets: frame.markets.map(market => ({
      ...market,
      expiresAt: toDate(market.expiresAt),
      orderbookUpdatedAt: toDate(market.orderbookUpdatedAt),
      lastPriceMovedAt: market.lastPriceMovedAt
        ? toDate(market.lastPriceMovedAt)
        : undefined,
    })),
  };
}

function createEmptySnapshot(
  bankrollUsd: number,
  peakBankrollUsd: number,
  openExposureUsd: number,
  now = new Date()
): PortfolioSnapshot {
  return {
    bankrollUsd,
    peakBankrollUsd,
    openExposureUsd,
    dailyPnlUsd: 0,
    marketExposureUsd: {},
    categoryExposureUsd: {},
    openOrderCount: 0,
    reconciliationStatus: "ok",
  };
}

class BacktestPortfolioProvider implements PortfolioProvider {
  private readonly openTradesByMarket = new Map<
    string,
    TrackedBacktestTrade[]
  >();
  private readonly settledTrades: SettledTrade[] = [];
  private bankrollUsd: number;
  private peakBankrollUsd: number;
  private openExposureUsd = 0;
  private readonly marketExposureUsd = new Map<string, number>();
  private readonly categoryExposureUsd = new Map<string, number>();

  constructor(initialBankrollUsd: number) {
    this.bankrollUsd = initialBankrollUsd;
    this.peakBankrollUsd = initialBankrollUsd;
  }

  snapshot(now = new Date()): Promise<PortfolioSnapshot> {
    return Promise.resolve(
      createEmptySnapshot(
        this.bankrollUsd,
        this.peakBankrollUsd,
        this.openExposureUsd,
        now
      )
    ).then(snapshot => ({
      ...snapshot,
      marketExposureUsd: Object.fromEntries(this.marketExposureUsd.entries()),
      categoryExposureUsd: Object.fromEntries(
        this.categoryExposureUsd.entries()
      ),
      openOrderCount: this.openTradesByMarket.size,
      dailyPnlUsd: this.bankrollUsd - this.peakBankrollUsd,
    }));
  }

  recordAuditBatch(audits: AgentDecisionAudit[]): void {
    for (const audit of audits) {
      const intent = audit.risk?.intent;
      const lifecycleUpdate = audit.lifecycleUpdate;
      if (!intent || !lifecycleUpdate) continue;

      const matchedSizeUsd = Math.max(0, lifecycleUpdate.matchedSizeUsd);
      if (matchedSizeUsd <= 0) continue;

      const trade: SettledTrade = {
        tradeId: audit.receipt?.localOrderId ?? intent.marketId,
        marketId: audit.marketId,
        category: audit.market?.category,
        side: intent.side,
        entryPrice: intent.limitPrice,
        sizeUsd: matchedSizeUsd,
        estimatedProbability: intent.estimatedProbability,
        confidence: intent.confidence,
        resolvedProbability: 0,
        hiddenEdge:
          Boolean(audit.deepEdge?.allowed) &&
          (audit.deepEdge?.anomaly.totalScore ?? 0) >= 0.7 &&
          (audit.deepEdge?.reasoning?.confidence ?? 0) >= 0.8,
        anomalyCausal:
          (audit.deepEdge?.reasoning?.expectedCorrectionPct ?? 0) >= 10,
      };

      const list = this.openTradesByMarket.get(audit.marketId) ?? [];
      list.push({ trade, resolved: false });
      this.openTradesByMarket.set(audit.marketId, list);

      this.openExposureUsd += matchedSizeUsd;
      this.marketExposureUsd.set(
        audit.marketId,
        (this.marketExposureUsd.get(audit.marketId) ?? 0) + matchedSizeUsd
      );
      if (audit.market?.category) {
        this.categoryExposureUsd.set(
          audit.market.category,
          (this.categoryExposureUsd.get(audit.market.category) ?? 0) +
            matchedSizeUsd
        );
      }
    }
  }

  settleResolvedMarkets(
    outcomes: Record<string, 0 | 1> | undefined,
    now = new Date()
  ): SettledTrade[] {
    if (!outcomes) return [];
    const newlySettled: SettledTrade[] = [];
    for (const [marketId, resolvedProbability] of Object.entries(outcomes)) {
      const trades = this.openTradesByMarket.get(marketId) ?? [];
      if (trades.length === 0) continue;

      for (const tracked of trades) {
        if (tracked.resolved) continue;
        tracked.trade.resolvedProbability = resolvedProbability;
        this.bankrollUsd += computeTradePnlUsd(tracked.trade);
        this.peakBankrollUsd = Math.max(this.peakBankrollUsd, this.bankrollUsd);
        this.openExposureUsd = Math.max(
          0,
          this.openExposureUsd - tracked.trade.sizeUsd
        );
        const marketExposure = this.marketExposureUsd.get(marketId) ?? 0;
        this.marketExposureUsd.set(
          marketId,
          Math.max(0, marketExposure - tracked.trade.sizeUsd)
        );
        if (tracked.trade.category) {
          const categoryExposure =
            this.categoryExposureUsd.get(tracked.trade.category) ?? 0;
          this.categoryExposureUsd.set(
            tracked.trade.category,
            Math.max(0, categoryExposure - tracked.trade.sizeUsd)
          );
        }
        tracked.resolved = true;
        this.settledTrades.push(tracked.trade);
        newlySettled.push(tracked.trade);
      }

      this.openTradesByMarket.set(
        marketId,
        trades.filter(trade => !trade.resolved)
      );
    }

    return newlySettled;
  }

  getSettledTrades(): SettledTrade[] {
    return [...this.settledTrades];
  }

  getOpenTradeCount(): number {
    let total = 0;
    for (const trades of Array.from(this.openTradesByMarket.values())) {
      total += trades.filter(
        (trade: TrackedBacktestTrade) => !trade.resolved
      ).length;
    }
    return total;
  }

  getOpenExposureUsd(): number {
    return this.openExposureUsd;
  }

  getFinalBankrollUsd(): number {
    return this.bankrollUsd;
  }
}

export class BacktestingEngine {
  private readonly initialBankrollUsd: number;
  private readonly intelligence: IntelligenceEngine;
  private readonly deepEdgeGate: DeepEdgeGate;
  private readonly execution: ExecutionAdapter;
  private readonly riskLimits: Partial<RiskLimits>;
  private readonly maxOrdersPerTick: number;
  private readonly persistAudits: boolean;

  constructor(options: BacktestingEngineOptions = {}) {
    this.initialBankrollUsd = options.initialBankrollUsd ?? 10_000;
    this.intelligence = options.intelligence ?? new LLMIntelligenceEngine();
    this.deepEdgeGate = options.deepEdgeGate ?? new ProductionDeepEdgeGate();
    this.execution =
      options.execution ??
      new PaperExecutionAdapter({
        orderTtlMs: 300_000,
        partialFillRatio: 0.5,
      });
    this.riskLimits = options.riskLimits ?? DEFAULT_RISK_LIMITS;
    this.maxOrdersPerTick = options.maxOrdersPerTick ?? 1;
    this.persistAudits = options.persistAudits ?? false;
  }

  async run(frames: HistoricalMarketFrame[]): Promise<BacktestRunResult> {
    const normalizedFrames = frames.map(normalizeFrame);
    let frameIndex = 0;
    const portfolio = new BacktestPortfolioProvider(this.initialBankrollUsd);
    const riskLimits: RiskLimits = {
      ...DEFAULT_RISK_LIMITS,
      ...this.riskLimits,
    };
    const marketProvider: MarketProvider = {
      scan: async () => normalizedFrames[frameIndex]?.markets ?? [],
    };

    const orchestrator = new AgentOrchestrator({
      marketProvider,
      portfolioProvider: portfolio,
      intelligence: this.intelligence,
      execution: this.execution,
      deepEdgeGate: this.deepEdgeGate,
      maxOrdersPerTick: this.maxOrdersPerTick,
      riskLimits,
      persistAudits: this.persistAudits,
      persistOrders: false,
      learningProfile: undefined,
    });

    const audits: AgentDecisionAudit[] = [];
    const equityCurve: BacktestEquityPoint[] = [];

    for (frameIndex = 0; frameIndex < normalizedFrames.length; frameIndex++) {
      const frame = normalizedFrames[frameIndex];
      const result = await orchestrator.tick(toDate(frame.timestamp));
      audits.push(...result.audits);
      portfolio.recordAuditBatch(result.audits);
      portfolio.settleResolvedMarkets(
        frame.resolvedOutcomes,
        toDate(frame.timestamp)
      );
      const snapshot = await portfolio.snapshot(toDate(frame.timestamp));
      equityCurve.push({
        timestamp: toDate(frame.timestamp),
        balanceUsd: snapshot.bankrollUsd,
        peakBalanceUsd: snapshot.peakBankrollUsd,
        openExposureUsd: snapshot.openExposureUsd,
        drawdownPct:
          snapshot.peakBankrollUsd > 0
            ? ((snapshot.peakBankrollUsd - snapshot.bankrollUsd) /
                snapshot.peakBankrollUsd) *
              100
            : 0,
      });
    }

    const unresolvedTradeCount = portfolio.getOpenTradeCount();
    const settledTrades = portfolio.getSettledTrades();
    const performance = summarizePerformance(settledTrades);

    return {
      framesProcessed: normalizedFrames.length,
      audits,
      trades: settledTrades,
      equityCurve,
      performance,
      finalBankrollUsd: portfolio.getFinalBankrollUsd(),
      openExposureUsd: portfolio.getOpenExposureUsd(),
      unresolvedTradeCount,
    };
  }
}

export async function loadHistoricalFramesFromFile(
  filePath: string
): Promise<HistoricalMarketFrame[]> {
  const text = await readFile(filePath, "utf8");
  const parsed = JSON.parse(text) as HistoricalMarketFrame[];
  if (!Array.isArray(parsed)) {
    throw new Error("Backtest data file must contain an array of frames");
  }
  return parsed.map(normalizeFrame);
}
