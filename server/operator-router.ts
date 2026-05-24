import { z } from "zod";
import { createPublicClient, formatEther, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { adminProcedure, router } from "./_core/trpc";
import { getBot } from "./_core/bot-singleton";
import { ENV } from "./_core/env";
import {
  getBotConfig,
  getClosedOrders,
  getEquityHistory,
  getExchangePortfolioState,
  getMarketByMarketId,
  getOpenOrders,
  getRecentDecisionAudits,
  getRecentTrades,
  insertOrder,
  updateBotConfig,
  updateOrderStatus,
} from "./db";
import {
  checkAndApproveAllowance,
  getPolymarketClient,
  getPolymarketLiveReadiness,
  PolymarketAdapter,
  PolymarketKillswitch,
} from "./exchange/polymarket";
import {
  createKalshiExecutionAdapter,
  getKalshiCashBalance,
  getKalshiMarket,
  listKalshiMarkets,
} from "./exchange/kalshi";
import { scanCrossExchangeArbitrage } from "./intelligence/arbitrage-scanner";
import { LLMIntelligenceEngine } from "./agent/intelligence";
import {
  ProductionDeepEdgeGate,
  type DeepEdgeDecision,
} from "./agent/deep-edge-gate";
import {
  DEFAULT_RISK_LIMITS,
  evaluateRisk,
  simulateRisk,
} from "./agent/risk-manager";
import {
  computeConsensusDivergenceScore,
  computeLiquidityScore,
  computeRecencyPenalty,
  computeVolumeVelocityScore,
  scoreOpportunity,
  type MarketSelectionScore,
} from "./agent/market-selection";
import { computeMicrostructureScore } from "./agent/book-pricing";
import { PaperExecutionAdapter } from "./agent/paper-execution";
import {
  resolvePolymarketTokenIds,
  scanPolymarketCandidates,
} from "./agent/polymarket-client";
import { activeProvider, activeProviderLatencyMs } from "./_core/llm";
import type {
  AgentMarket,
  EnsembleDecision,
  ExecutionReceipt,
  RiskDecision,
  RiskLimits,
  TradeIntent,
} from "./agent/types";

const settingsSchema = z.object({
  maxPositionUsd: z.number().min(10).max(500),
  maxDrawdownPct: z.number().min(5).max(25),
  maxSpread: z.number().min(0.01).max(0.2).default(0.1),
  minEdgePct: z.number().min(3).max(15),
  minConfidence: z.number().min(0.5).max(0.95),
  fractionalKelly: z.number().min(0.1).max(0.5),
  maxSingleMarketExposurePct: z.number().min(1).max(20),
  maxTotalExposurePct: z.number().min(5).max(50),
  maxDailyLossPct: z.number().min(1).max(10),
  orderTtlMs: z.enum(["60000", "300000", "900000", "3600000"]),
  categoryCaps: z.object({
    Sports: z.number().min(1).max(50),
    Politics: z.number().min(1).max(50),
    Crypto: z.number().min(1).max(50),
    Other: z.number().min(1).max(50),
  }),
});

const operatorOrderSchema = z.object({
  marketId: z.string().min(1),
  exchange: z.enum(["polymarket", "kalshi"]).default("kalshi"),
  side: z.enum(["yes", "no"]),
  sizeUsd: z.number().min(1).max(10_000),
  price: z.number().min(0.01).max(0.99),
});

type HybridBreakdown = {
  llmProbabilityConfidence: number;
  deepEdgeAnomaly: number;
  marketSelection: number;
  liquidity: number;
  volumeVelocity: number;
  consensusDivergence: number;
  recencyPenalty: number;
  socialSignal: number;
  microstructure: number;
  socialTweetCount: number;
  socialTopTweets: Array<{ snippet: string; engagement: number }>;
};

function numberFrom(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function pctChange(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function getWalletAddress(): string | null {
  if (ENV.polymarketFunderAddress) return ENV.polymarketFunderAddress;
  if (!ENV.polymarketPrivateKey) return null;
  try {
    const key = ENV.polymarketPrivateKey.startsWith("0x")
      ? ENV.polymarketPrivateKey
      : `0x${ENV.polymarketPrivateKey}`;
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function getMaticBalance(address: string | null): Promise<number | null> {
  if (!address || !ENV.polygonRpcUrl) return null;
  const client = createPublicClient({
    chain: polygon,
    transport: http(ENV.polygonRpcUrl),
  });
  const balance = await client.getBalance({
    address: address as `0x${string}`,
  });
  return Number(formatEther(balance));
}

async function getPolygonTransactions(address: string | null) {
  const key = process.env.POLYGONSCAN_API_KEY ?? "";
  if (!address || !key) {
    return {
      available: false,
      reason: "POLYGONSCAN_API_KEY and wallet address are required",
      transactions: [] as Array<{
        hash: string;
        type: string;
        amount: number;
        status: string;
        url: string;
        timestamp: string;
      }>,
    };
  }

  const params = new URLSearchParams({
    module: "account",
    action: "tokentx",
    address,
    sort: "desc",
    page: "1",
    offset: "20",
    apikey: key,
  });
  const response = await fetch(`https://api.polygonscan.com/api?${params}`);
  if (!response.ok) throw new Error("Polygonscan request failed");
  const body = (await response.json()) as {
    result?: Array<Record<string, string>>;
  };

  return {
    available: true,
    reason: null,
    transactions: (body.result ?? []).slice(0, 20).map(tx => {
      const decimals = Number(tx.tokenDecimal ?? "6");
      const amount = Number(tx.value ?? "0") / 10 ** decimals;
      return {
        hash: String(tx.hash ?? ""),
        type: tx.to?.toLowerCase() === address.toLowerCase() ? "IN" : "OUT",
        amount,
        status: "CONFIRMED",
        url: `https://polygonscan.com/tx/${tx.hash}`,
        timestamp: new Date(Number(tx.timeStamp ?? "0") * 1000).toISOString(),
      };
    }),
  };
}

function buildRiskLimitsFromConfig(
  config: Awaited<ReturnType<typeof getBotConfig>>
): RiskLimits {
  return {
    ...DEFAULT_RISK_LIMITS,
    minEdge: numberFrom(config?.edgeThreshold) || DEFAULT_RISK_LIMITS.minEdge,
    minConfidence:
      numberFrom(config?.minConfidence) || DEFAULT_RISK_LIMITS.minConfidence,
    maxOrderSizeUsd: ENV.maxPositionUsd || DEFAULT_RISK_LIMITS.maxOrderSizeUsd,
    maxDrawdownPct:
      numberFrom(config?.drawdownLimit) || DEFAULT_RISK_LIMITS.maxDrawdownPct,
    maxTotalExposurePct:
      numberFrom(config?.maxTotalExposure) ||
      DEFAULT_RISK_LIMITS.maxTotalExposurePct,
    maxSingleMarketExposurePct:
      numberFrom(config?.maxSingleExposure) ||
      DEFAULT_RISK_LIMITS.maxSingleMarketExposurePct,
    fractionalKelly:
      numberFrom(config?.kellyFraction) || DEFAULT_RISK_LIMITS.fractionalKelly,
  };
}

export function hybridScore(input: {
  ensemble?: EnsembleDecision | null;
  deepEdge?: DeepEdgeDecision | null;
  selection?: MarketSelectionScore | null;
  market?: AgentMarket | null;
}): { score: number; breakdown: HybridBreakdown } {
  const llmProbabilityConfidence = input.ensemble?.confidence ?? 0;
  const deepEdgeAnomaly = input.deepEdge?.anomaly.totalScore ?? 0;
  const marketSelection = input.selection?.total ?? 0;
  const liquidity = input.market
    ? computeLiquidityScore(input.market.liquidity)
    : 0;
  const volumeVelocity = input.market
    ? computeVolumeVelocityScore(input.market.volume24h, input.market.volume1h)
    : 0;
  const consensusDivergence =
    input.market && input.ensemble
      ? computeConsensusDivergenceScore(
          input.ensemble.estimatedProbability,
          input.market.midpoint
        )
      : 0;
  const recencyPenalty = input.market
    ? computeRecencyPenalty(
        input.market.lastPriceMovedAt,
        input.market.orderbookUpdatedAt
      )
    : 0;
  const microstructure = input.market
    ? computeMicrostructureScore(input.market)
    : 0;
  // Collect all tweets across all probability estimates
  const allTweets = (input.ensemble?.estimates ?? []).flatMap(
    e => e.socialSignals ?? []
  );

  // Engagement-weighted social signal: 1 viral tweet > 20 dead ones
  const totalEngagement = allTweets.reduce(
    (sum, t) =>
      sum + t.metrics.likes + t.metrics.retweets * 2 + t.metrics.replies * 1.5,
    0
  );
  const socialSignal = Math.min(1, totalEngagement / 1000);

  // Top-3 tweets by engagement for tooltip
  const socialTopTweets = allTweets
    .map(t => ({
      snippet: t.text.slice(0, 80),
      engagement:
        t.metrics.likes + t.metrics.retweets * 2 + t.metrics.replies * 1.5,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 3);

  const score =
    (llmProbabilityConfidence * 0.18 +
      deepEdgeAnomaly * 0.17 +
      marketSelection * 0.17 +
      liquidity * 0.09 +
      volumeVelocity * 0.09 +
      consensusDivergence * 0.09 +
      socialSignal * 0.09 +
      recencyPenalty * 0.04 +
      microstructure * 0.08) *
    100;

  return {
    score: Math.round(score * 100) / 100,
    breakdown: {
      llmProbabilityConfidence,
      deepEdgeAnomaly,
      marketSelection,
      liquidity,
      volumeVelocity,
      consensusDivergence,
      recencyPenalty,
      socialSignal,
      microstructure,
      socialTweetCount: allTweets.length,
      socialTopTweets,
    },
  };
}

async function enrichOrder(
  order: Awaited<ReturnType<typeof getOpenOrders>>[number]
) {
  const [market, audits] = await Promise.all([
    getMarketByMarketId(order.marketId),
    getRecentDecisionAudits(250),
  ]);
  const audit = audits.find(
    item => item.orderNonce === order.nonce || item.marketId === order.marketId
  );
  const diagnostics = (audit?.diagnostics ?? {}) as Record<string, unknown>;
  const risk = diagnostics.risk as RiskDecision | undefined;
  const ensemble = diagnostics.ensemble as EnsembleDecision | undefined;
  const deepEdge = diagnostics.deepEdge as DeepEdgeDecision | undefined;
  const selection = diagnostics.selectionScore as
    | MarketSelectionScore
    | undefined;
  const marketFromAudit = diagnostics.market as AgentMarket | undefined;
  const marketForScore =
    marketFromAudit ??
    (market
      ? {
          marketId: market.marketId,
          question: market.question,
          category: market.category ?? undefined,
          yesTokenId: "",
          noTokenId: "",
          bestBid: numberFrom(market.bestBid),
          bestAsk: numberFrom(market.bestAsk),
          spread: numberFrom(market.spread),
          midpoint:
            (numberFrom(market.bestBid) + numberFrom(market.bestAsk)) / 2,
          volume24h: numberFrom(market.volume24h),
          liquidity: 0,
          expiresAt: market.expiresAt ?? new Date(),
          orderbookUpdatedAt: market.lastUpdatedAt,
        }
      : null);
  const hybrid = hybridScore({
    ensemble,
    deepEdge,
    selection,
    market: marketForScore,
  });
  const entry = numberFrom(order.price);
  const current = marketForScore?.midpoint ?? entry;
  const pnlUsd =
    order.side === "buy"
      ? (current - entry) * numberFrom(order.size)
      : (entry - current) * numberFrom(order.size);

  return {
    ...order,
    exchange: marketForScore?.exchange ?? "polymarket",
    question: market?.question ?? order.marketId,
    category: market?.category ?? "Other",
    currentBestBid: marketForScore?.bestBid ?? null,
    currentBestAsk: marketForScore?.bestAsk ?? null,
    unrealizedPnlUsd: pnlUsd,
    unrealizedPnlPct:
      entry > 0 ? (pnlUsd / (entry * numberFrom(order.size))) * 100 : 0,
    hybrid,
    reasoning: {
      reasons: audit?.reasons ?? [],
      diagnostics,
      audit,
    },
  };
}

async function findMarket(
  marketId: string,
  exchange: "polymarket" | "kalshi"
): Promise<AgentMarket> {
  if (exchange === "kalshi") return getKalshiMarket(marketId);
  const candidates = await scanPolymarketCandidates({
    limit: 100,
    minVolume24h: 0,
    minLiquidity: 0,
  });
  const market = candidates.find(item => item.marketId === marketId);
  if (!market)
    throw new Error("Market is not currently available from Polymarket");
  return market;
}

async function evaluateOperatorPick(
  input: z.infer<typeof operatorOrderSchema>
) {
  const [config, portfolioState, market] = await Promise.all([
    getBotConfig(),
    getExchangePortfolioState(),
    findMarket(input.marketId, input.exchange),
  ]);
  const limits = buildRiskLimitsFromConfig(config);
  const intelligence = new LLMIntelligenceEngine();
  const ensemble = await intelligence.evaluate(market);
  if (!ensemble)
    throw new Error("Intelligence engine did not return a forecast");

  const risk = evaluateRisk(market, ensemble, portfolioState.snapshot, limits);
  const deepEdge = await new ProductionDeepEdgeGate().evaluate(
    market,
    ensemble,
    {}
  );
  const selection = scoreOpportunity(
    market,
    risk,
    undefined,
    new Date(),
    ensemble
  );
  const hybrid = hybridScore({ ensemble, deepEdge, selection, market });
  return { market, ensemble, risk, deepEdge, selection, hybrid };
}

export const operatorRouter = router({
  getHealth: adminProcedure.query(async () => {
    return {
      status: "operational",
      uptime: process.uptime(),
      timestamp: new Date(),
      memory: process.memoryUsage(),
    };
  }),

  simulateTrade: adminProcedure
    .input(
      z.object({
        marketId: z.string(),
        exchange: z.enum(["polymarket", "kalshi"]),
        estimatedProbability: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      })
    )
    .query(async ({ input }) => {
      const [portfolioState, market] = await Promise.all([
        getExchangePortfolioState(new Date()),
        findMarket(input.marketId, input.exchange),
      ]);

      const ensemble: EnsembleDecision = {
        marketId: input.marketId,
        outcome: "yes",
        estimatedProbability: input.estimatedProbability,
        confidence: input.confidence,
        estimates: [],
        modelDisagreement: 0,
        evidenceSummary: ["Simulation input"],
        generatedAt: new Date(),
      };

      return simulateRisk(
        market,
        ensemble,
        portfolioState.snapshot,
        DEFAULT_RISK_LIMITS
      );
    }),

  dashboard: adminProcedure.query(async () => {
    const now = new Date();
    const [
      botStatus,
      portfolioState,
      equity24h,
      equityAll,
      trades,
      openOrders,
      closedOrders,
      audits,
    ] = await Promise.all([
      getBotConfig(),
      getExchangePortfolioState(now),
      getEquityHistory(24),
      getEquityHistory(24 * 365 * 20),
      getRecentTrades(100),
      getOpenOrders(),
      getClosedOrders(100),
      getRecentDecisionAudits(250),
    ]);
    const walletAddress = getWalletAddress();
    const [maticBalance, transactions, activeLines, kalshiBalance, arbitrage] =
      await Promise.all([
        getMaticBalance(walletAddress).catch(() => null),
        getPolygonTransactions(walletAddress).catch(error => ({
          available: false,
          reason: String(error),
          transactions: [],
        })),
        Promise.all(openOrders.map(enrichOrder)),
        getKalshiCashBalance().catch(error => {
          console.warn(
            "[OperatorDashboard] Kalshi balance unavailable:",
            error
          );
          return null;
        }),
        Promise.all([
          scanPolymarketCandidates({
            limit: 25,
            minVolume24h: 0,
            minLiquidity: 0,
          }),
          listKalshiMarkets(undefined, { limit: 25 }),
        ])
          .then(([polymarket, kalshi]) =>
            scanCrossExchangeArbitrage([...polymarket, ...kalshi])
          )
          .catch(error => {
            console.warn(
              "[OperatorDashboard] Arbitrage scan unavailable:",
              error
            );
            return [];
          }),
      ]);

    const currentBalance = portfolioState.snapshot.bankrollUsd;
    const peakBalance = portfolioState.snapshot.peakBankrollUsd;
    const drawdownUsd = Math.max(0, peakBalance - currentBalance);
    const drawdownPct = peakBalance > 0 ? (drawdownUsd / peakBalance) * 100 : 0;

    const dayBaseline = equity24h[0]?.balance
      ? numberFrom(equity24h[0].balance)
      : currentBalance;
    const allBaseline = equityAll[0]?.balance
      ? numberFrom(equityAll[0].balance)
      : currentBalance;
    const readiness = getPolymarketLiveReadiness();

    return {
      status: {
        isRunning: botStatus?.isRunning === 1,
        isPaused: botStatus?.isPaused === 1,
        executionMode: botStatus?.executionMode ?? "paper",
        killswitchArmed: readiness.ready || ENV.polymarketKillswitchArmed,
        readiness,
      },
      wallet: {
        address: walletAddress,
        usdcBalance: currentBalance,
        usdc24hChangeUsd: currentBalance - dayBaseline,
        usdc24hChangePct: pctChange(currentBalance, dayBaseline),
        maticBalance,
        depositAddress: walletAddress,
        transactions,
      },
      bankrolls: {
        polymarketUsdc: currentBalance,
        peakBankrollUsdc: peakBalance,
        kalshiUsd: kalshiBalance,
      },
      pnl: {
        todayUsd: currentBalance - dayBaseline,
        todayPct: pctChange(currentBalance, dayBaseline),
        allTimeUsd: currentBalance - allBaseline,
        allTimePct: pctChange(currentBalance, allBaseline),
        currentDrawdownUsd: drawdownUsd,
        currentDrawdownPct: drawdownPct,
      },
      portfolio: portfolioState,
      settings: {
        maxPositionUsd: ENV.maxPositionUsd,
        maxDrawdownPct:
          numberFrom(botStatus?.drawdownLimit) ||
          DEFAULT_RISK_LIMITS.maxDrawdownPct,
        maxSpread: 0.1, // Default
        minEdgePct:
          (numberFrom(botStatus?.edgeThreshold) ||
            DEFAULT_RISK_LIMITS.minEdge) * 100,
        minConfidence:
          numberFrom(botStatus?.minConfidence) ||
          DEFAULT_RISK_LIMITS.minConfidence,
        fractionalKelly:
          numberFrom(botStatus?.kellyFraction) ||
          DEFAULT_RISK_LIMITS.fractionalKelly,
        maxSingleMarketExposurePct:
          DEFAULT_RISK_LIMITS.maxSingleMarketExposurePct,
        maxTotalExposurePct: DEFAULT_RISK_LIMITS.maxTotalExposurePct,
        maxDailyLossPct: DEFAULT_RISK_LIMITS.maxDailyLossPct,
        orderTtlMs: String(ENV.orderTtlMs),
        categoryCaps: {
          Sports: DEFAULT_RISK_LIMITS.maxCategoryExposurePct,
          Politics: DEFAULT_RISK_LIMITS.maxCategoryExposurePct,
          Crypto: DEFAULT_RISK_LIMITS.maxCategoryExposurePct,
          Other: DEFAULT_RISK_LIMITS.maxCategoryExposurePct,
        },
      },
      activeLines,
      arbitrage,
      closedLines: closedOrders.map(order => ({
        ...order,
        finalPnlUsd: 0,
        finalPnlPct: 0,
        outcome: order.status === "filled" ? "CLOSED" : order.status,
      })),
      performance: {
        equity: equityAll,
        trades,
        audits,
      },
      llm: {
        provider: activeProvider,
        latencyMs: activeProviderLatencyMs,
        primaryModel: ENV.llmPrimaryModel,
        reasonerModel: ENV.llmReasonerModel,
        extractorModel: ENV.llmExtractorModel,
        isFallback:
          activeProvider !== "unconfigured" &&
          !activeProvider.startsWith("ollama"),
      },
    };
  }),

  updateSettings: adminProcedure
    .input(settingsSchema)
    .mutation(async ({ input }) => {
      await updateBotConfig({
        edgeThreshold: (input.minEdgePct / 100).toString(),
        minConfidence: input.minConfidence.toString(),
        kellyFraction: input.fractionalKelly.toString(),
        drawdownLimit: input.maxDrawdownPct.toString(),
        maxSingleExposure: input.maxSingleMarketExposurePct.toString(),
        maxTotalExposure: input.maxTotalExposurePct.toString(),
        orderTimeoutSeconds: Math.round(Number(input.orderTtlMs) / 1000),
      });
      process.env.MAX_POSITION_USD = String(input.maxPositionUsd);
      process.env.MAX_DRAWDOWN_PCT = String(input.maxDrawdownPct / 100);
      process.env.MAX_SPREAD = String(input.maxSpread);
      process.env.MIN_EDGE_PCT = String(input.minEdgePct);
      process.env.MIN_CONFIDENCE = String(input.minConfidence);
      process.env.FRACTIONAL_KELLY = String(input.fractionalKelly);
      process.env.MAX_DAILY_LOSS_PCT = String(input.maxDailyLossPct);
      process.env.ORDER_TTL_MS = String(input.orderTtlMs);
      return { success: true, applies: "next_tick" as const };
    }),

  emergencyStop: adminProcedure.mutation(async () => {
    // First: stop the in-memory bot (cancels all open orders on exchange and clears intervals).
    const bot = getBot();
    if (bot) {
      await bot.stop();
    }
    await updateBotConfig({ isRunning: 0, emergencyBrakeTriggered: 1 });
    return { success: true };
  }),

  approveClobAllowance: adminProcedure.mutation(async () => {
    const client = await getPolymarketClient();
    await checkAndApproveAllowance(client, ENV.polymarketMaxNotionalUsd);
    return { success: true };
  }),

  searchMarkets: adminProcedure
    .input(
      z.object({
        query: z.string().min(1),
        exchange: z.enum(["polymarket", "kalshi", "both"]).default("kalshi"),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const [polymarket, kalshi] = await Promise.all([
        input.exchange === "kalshi"
          ? Promise.resolve([])
          : scanPolymarketCandidates({
              limit: Math.max(input.limit * 5, 50),
              minLiquidity: 0,
              minVolume24h: 0,
            }),
        input.exchange === "polymarket"
          ? Promise.resolve([])
          : listKalshiMarkets(undefined, {
              limit: Math.max(input.limit * 5, 50),
            }),
      ]);
      const markets = [...kalshi, ...polymarket];
      const needle = input.query.toLowerCase();
      return markets
        .filter(
          market =>
            market.question.toLowerCase().includes(needle) ||
            (market.category ?? "").toLowerCase().includes(needle)
        )
        .slice(0, input.limit);
    }),

  runIntelligence: adminProcedure
    .input(
      operatorOrderSchema.pick({ marketId: true, exchange: true, side: true })
    )
    .mutation(async ({ input }) => {
      const evaluated = await evaluateOperatorPick({
        marketId: input.marketId,
        exchange: input.exchange,
        side: input.side,
        sizeUsd: 1,
        price: 0.5,
      });
      return evaluated;
    }),

  submitOperatorOrder: adminProcedure
    .input(operatorOrderSchema)
    .mutation(async ({ input }) => {
      const evaluated = await evaluateOperatorPick(input);
      if (!evaluated.risk.allowed || !evaluated.deepEdge.allowed) {
        return {
          submitted: false,
          vetoed: true,
          reasons: [...evaluated.risk.reasons, ...evaluated.deepEdge.reasons],
          evaluation: evaluated,
        };
      }

      const tokenId =
        input.side === "yes"
          ? evaluated.market.yesTokenId
          : evaluated.market.noTokenId;
      const intent: TradeIntent = {
        exchange: evaluated.market.exchange,
        marketId: evaluated.market.marketId,
        tokenId,
        outcome: input.side,
        side: "buy",
        limitPrice: input.price,
        sizeUsd: input.sizeUsd,
        edge: evaluated.risk.intent?.edge ?? 0,
        estimatedProbability: evaluated.ensemble.estimatedProbability,
        confidence: evaluated.ensemble.confidence,
        rationale: evaluated.ensemble.evidenceSummary,
      };
      const receipt = await new PaperExecutionAdapter({
        orderTtlMs: ENV.orderTtlMs,
        partialFillRatio: 0.5,
      }).place(intent, evaluated.market);
      if (receipt.status === "rejected") {
        return {
          submitted: false,
          vetoed: true,
          reasons: [
            receipt.rejectionReason ?? "paper execution rejected order",
          ],
          evaluation: evaluated,
        };
      }
      await insertOrder({
        nonce: receipt.localOrderId,
        exchangeOrderId: receipt.exchangeOrderId,
        marketId: intent.marketId,
        tokenId: intent.tokenId,
        side: intent.side,
        price: String(intent.limitPrice),
        size: String(intent.sizeUsd),
        status: "pending",
        lifecycleState: "ACCEPTED_BY_CLOB",
        edgeAtPlacement: String(intent.edge),
        confidenceAtPlacement: String(intent.confidence),
        placedAt: receipt.submittedAt,
        acceptedAt: receipt.submittedAt,
        expiresAt: new Date(receipt.submittedAt.getTime() + ENV.orderTtlMs),
      });
      return { submitted: true, vetoed: false, receipt, evaluation: evaluated };
    }),

  executeArbitragePair: adminProcedure
    .input(
      z.object({
        polymarketId: z.string().min(1),
        kalshiId: z.string().min(1),
        sizeUsd: z.number().min(1).max(10_000).default(10),
      })
    )
    .mutation(async ({ input }) => {
      const [polyMarket, kalshiMarket] = await Promise.all([
        findMarket(input.polymarketId, "polymarket"),
        findMarket(input.kalshiId, "kalshi"),
      ]);
      const opportunities = await scanCrossExchangeArbitrage([
        polyMarket,
        kalshiMarket,
      ]);
      const opportunity = opportunities[0];
      if (!opportunity) {
        return {
          submitted: false,
          reason: "No current cross-exchange arbitrage remains for this pair",
        };
      }

      const liveMode =
        process.env.EXECUTION_MODE === "live" || ENV.liveTradingEnabled;

      // arbs.xyz opportunities have empty tokenIds — resolve them before execution
      let resolvedPolyTokenIds: {
        yesTokenId: string;
        noTokenId: string;
      } | null = null;
      if (!opportunity.intents[0].tokenId) {
        resolvedPolyTokenIds = await resolvePolymarketTokenIds(
          opportunity.polymarket.marketId
        ).catch(err => {
          console.warn(
            "[ArbitrageExec] Could not resolve Polymarket token IDs:",
            err
          );
          return null;
        });
        if (!resolvedPolyTokenIds) {
          return {
            submitted: false,
            reason: `Could not resolve Polymarket token IDs for market ${opportunity.polymarket.marketId}. The market may be inactive or unavailable on the CLOB.`,
          };
        }
        // Back-fill the market object so downstream adapters have the full picture
        opportunity.polymarket.yesTokenId = resolvedPolyTokenIds.yesTokenId;
        opportunity.polymarket.noTokenId = resolvedPolyTokenIds.noTokenId;
      }

      const polyTokenId =
        resolvedPolyTokenIds?.yesTokenId ?? opportunity.intents[0].tokenId;

      const polyIntent = {
        ...opportunity.intents[0],
        tokenId: polyTokenId,
        sizeUsd: input.sizeUsd,
      };
      const kalshiIntent = {
        ...opportunity.intents[1],
        sizeUsd: input.sizeUsd,
      };

      let polyReceipt: ExecutionReceipt | null = null;
      let kalshiReceipt: ExecutionReceipt | null = null;
      let partialFailure: string | null = null;

      if (liveMode) {
        const [polyAdapter, kalshiAdapter] = await Promise.all([
          PolymarketAdapter.create(),
          createKalshiExecutionAdapter(),
        ]);

        // Execute both legs simultaneously
        const [polyResult, kalshiResult] = await Promise.allSettled([
          polyAdapter.place(polyIntent, opportunity.polymarket),
          kalshiAdapter.place(kalshiIntent, opportunity.kalshi),
        ]);

        if (polyResult.status === "fulfilled") {
          polyReceipt = polyResult.value;
        } else {
          partialFailure = `Polymarket leg failed: ${String(polyResult.reason)}`;
          console.error(
            "[ArbitrageExec] Polymarket leg failed",
            polyResult.reason
          );
        }

        if (kalshiResult.status === "fulfilled") {
          kalshiReceipt = kalshiResult.value;
        } else {
          const msg = `Kalshi leg failed: ${String(kalshiResult.reason)}`;
          partialFailure = partialFailure ? `${partialFailure}; ${msg}` : msg;
          console.error(
            "[ArbitrageExec] Kalshi leg failed",
            kalshiResult.reason
          );
        }

        // If only one leg filled, warn loudly — position is no longer hedged
        if (
          (polyReceipt && !kalshiReceipt) ||
          (!polyReceipt && kalshiReceipt)
        ) {
          console.error(
            "[ArbitrageExec] PARTIAL FILL — one leg executed, the other did not. Manual intervention may be required.",
            { polyReceipt, kalshiReceipt }
          );
        }
      } else {
        const paper = new PaperExecutionAdapter({
          orderTtlMs: ENV.orderTtlMs,
          partialFillRatio: 0.5,
        });
        [polyReceipt, kalshiReceipt] = await Promise.all([
          paper.place(polyIntent, opportunity.polymarket),
          paper.place(kalshiIntent, opportunity.kalshi),
        ]);
      }

      const now = new Date();
      await Promise.all([
        polyReceipt && polyReceipt.status !== "rejected"
          ? insertOrder({
              nonce: polyReceipt.localOrderId,
              exchangeOrderId: polyReceipt.exchangeOrderId,
              marketId: polyIntent.marketId,
              tokenId: polyIntent.tokenId,
              side: polyIntent.side,
              price: String(polyIntent.limitPrice),
              size: String(polyIntent.sizeUsd),
              status: "pending",
              lifecycleState: "ACCEPTED_BY_CLOB",
              edgeAtPlacement: String(opportunity.gap),
              confidenceAtPlacement: String(
                opportunity.semanticMatchConfidence
              ),
              placedAt: polyReceipt.submittedAt,
              acceptedAt: polyReceipt.submittedAt,
              expiresAt: new Date(
                polyReceipt.submittedAt.getTime() + ENV.orderTtlMs
              ),
            })
          : null,
        kalshiReceipt && kalshiReceipt.status !== "rejected"
          ? insertOrder({
              nonce: kalshiReceipt.localOrderId,
              exchangeOrderId: kalshiReceipt.exchangeOrderId,
              marketId: kalshiIntent.marketId,
              tokenId: kalshiIntent.tokenId ?? "",
              side: kalshiIntent.side,
              price: String(kalshiIntent.limitPrice),
              size: String(kalshiIntent.sizeUsd),
              status: "pending",
              lifecycleState: "ACCEPTED_BY_CLOB",
              edgeAtPlacement: String(opportunity.gap),
              confidenceAtPlacement: String(
                opportunity.semanticMatchConfidence
              ),
              placedAt: kalshiReceipt.submittedAt,
              acceptedAt: kalshiReceipt.submittedAt,
              expiresAt: new Date(
                kalshiReceipt.submittedAt.getTime() + ENV.orderTtlMs
              ),
            })
          : null,
      ]);

      return {
        submitted: Boolean(polyReceipt || kalshiReceipt),
        partialFailure,
        liveMode,
        receipts: { polymarket: polyReceipt, kalshi: kalshiReceipt },
        opportunity,
      };
    }),

  cancelOrder: adminProcedure
    .input(z.object({ nonce: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await updateOrderStatus(input.nonce, "cancel_requested");
      return { success: true };
    }),

  start: adminProcedure.mutation(async () => {
    await updateBotConfig({
      isRunning: 1,
      isPaused: 0,
      emergencyBrakeTriggered: 0,
    });
    return { success: true };
  }),

  stop: adminProcedure.mutation(async () => {
    await updateBotConfig({ isRunning: 0 });
    return { success: true };
  }),

  pause: adminProcedure.mutation(async () => {
    await updateBotConfig({ isPaused: 1 });
    return { success: true };
  }),

  resume: adminProcedure.mutation(async () => {
    await updateBotConfig({ isPaused: 0, emergencyBrakeTriggered: 0 });
    return { success: true };
  }),
});
