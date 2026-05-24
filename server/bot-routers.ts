import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import {
  getBotConfig,
  updateBotConfig,
  getRecentTrades,
  getEquityHistory,
  getOpenOrders,
  getRecentSignals,
} from "./db";
import { getPolymarketLiveReadiness } from "./exchange/polymarket";
import { getBot } from "./_core/bot-singleton";

export const botRouter = router({
  // Get bot status
  status: publicProcedure.query(async () => {
    const config = await getBotConfig();
    return {
      isRunning: config?.isRunning === 1,
      isPaused: config?.isPaused === 1,
      emergencyBrakeTriggered: config?.emergencyBrakeTriggered === 1,
      executionMode: config?.executionMode || "paper",
      config,
    };
  }),

  // Start bot
  start: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");
    const bot = getBot();
    if (bot) {
      await bot.start();
    } else {
      await updateBotConfig({ isRunning: 1, isPaused: 0 });
    }
    return { success: true };
  }),

  // Stop bot
  stop: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");
    const bot = getBot();
    if (bot) {
      await bot.stop();
    } else {
      await updateBotConfig({ isRunning: 0 });
    }
    return { success: true };
  }),

  // Pause bot
  pause: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");
    const bot = getBot();
    if (bot) {
      await bot.pause();
    } else {
      await updateBotConfig({ isPaused: 1 });
    }
    return { success: true };
  }),

  // Resume bot
  resume: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new Error("Unauthorized");
    const bot = getBot();
    if (bot) {
      await bot.resume();
    } else {
      await updateBotConfig({ isPaused: 0, emergencyBrakeTriggered: 0 });
    }
    return { success: true };
  }),

  // Set execution mode
  setExecutionMode: protectedProcedure
    .input((v: unknown) => {
      const val = v as { mode: string };
      if (val.mode !== "paper" && val.mode !== "live")
        throw new Error("Invalid mode");
      return val;
    })
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");
      if (input.mode === "live") {
        const readiness = getPolymarketLiveReadiness();
        if (!readiness.ready) {
          throw new Error(
            `Live trading is not configured: ${readiness.missing.join(", ")}`
          );
        }
      }
      await updateBotConfig({ executionMode: input.mode as "paper" | "live" });
      return { success: true, mode: input.mode };
    }),

  // Get recent trades
  recentTrades: publicProcedure
    .input((v: unknown) => {
      const val = v as { limit?: number };
      return { limit: val.limit || 20 };
    })
    .query(async ({ input }) => {
      return getRecentTrades(input.limit);
    }),

  // Get equity history
  equityHistory: publicProcedure
    .input((v: unknown) => {
      const val = v as { hoursBack?: number };
      return { hoursBack: val.hoursBack || 24 };
    })
    .query(async ({ input }) => {
      return getEquityHistory(input.hoursBack);
    }),

  // Get open orders
  openOrders: publicProcedure.query(async () => {
    return getOpenOrders();
  }),

  // Get recent signals for a market
  marketSignals: publicProcedure
    .input((v: unknown) => {
      const val = v as { marketId: string; minutesBack?: number };
      return val;
    })
    .query(async ({ input }) => {
      return getRecentSignals(input.marketId, input.minutesBack || 5);
    }),

  // Update bot config
  updateConfig: protectedProcedure
    .input((v: unknown) => v as Record<string, unknown>)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Unauthorized");
      await updateBotConfig(input);
      return { success: true };
    }),
});
