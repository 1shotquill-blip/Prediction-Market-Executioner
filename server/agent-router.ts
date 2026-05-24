import { z } from "zod";
import { adminProcedure, router } from "./_core/trpc";
import { DEFAULT_RISK_LIMITS } from "./agent/risk-manager";
import { scanTradableMarkets } from "./agent/market-scanner";
import { getRecentDecisionAudits } from "./db";

const scanInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  minVolume24h: z.number().min(0).default(1000),
  minLiquidity: z.number().min(0).default(100),
  maxSpread: z.number().min(0).max(1).default(DEFAULT_RISK_LIMITS.maxSpread),
  maxMarketDataAgeSeconds: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(DEFAULT_RISK_LIMITS.maxMarketDataAgeSeconds),
});

export const agentRouter = router({
  scanCandidates: adminProcedure
    .input(scanInputSchema)
    .query(async ({ input }) => {
      const limits = {
        ...DEFAULT_RISK_LIMITS,
        maxSpread: input.maxSpread,
        maxMarketDataAgeSeconds: input.maxMarketDataAgeSeconds,
      };

      const result = await scanTradableMarkets(
        {
          limit: input.limit,
          offset: input.offset,
          minVolume24h: input.minVolume24h,
          minLiquidity: input.minLiquidity,
        },
        limits
      );

      return {
        tradable: result.tradable,
        rejected: result.rejected.map(({ market, reason }) => ({
          marketId: market.marketId,
          question: market.question,
          bestBid: market.bestBid,
          bestAsk: market.bestAsk,
          spread: market.spread,
          volume24h: market.volume24h,
          liquidity: market.liquidity,
          reason,
        })),
      };
    }),

  recentDecisionAudits: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      return getRecentDecisionAudits(input.limit);
    }),
});
