import { eq, desc, and, gte, lte, lt, gt, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  markets,
  signals,
  orders,
  trades,
  equitySnapshots,
  botConfig,
  bayesianPriors,
  decisionAudits,
  InsertMarket,
  InsertSignal,
  InsertOrder,
  InsertTrade,
  InsertEquitySnapshot,
  InsertBotConfig,
  InsertBayesianPrior,
  InsertDecisionAudit,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Markets
 */
export async function getMarketByMarketId(marketId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(markets)
    .where(eq(markets.marketId, marketId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getEligibleMarkets(minVolume: number, maxSpread: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(markets)
    .where(
      and(
        gte(markets.volume24h, minVolume.toString()),
        lte(markets.spread, maxSpread.toString()),
        gt(markets.expiresAt, new Date())
      )
    )
    .limit(50);
}

export async function upsertMarket(market: InsertMarket) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(markets)
    .values(market)
    .onDuplicateKeyUpdate({
      set: {
        volume24h: market.volume24h,
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
        spread: market.spread,
        lastUpdatedAt: new Date(),
      },
    });
}

/**
 * Signals
 */
export async function insertSignal(signal: InsertSignal) {
  const db = await getDb();
  if (!db) return;
  await db.insert(signals).values(signal);
}

export async function getRecentSignals(
  marketId: string,
  minutesBack: number = 5
) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - minutesBack * 60 * 1000);
  return db
    .select()
    .from(signals)
    .where(
      and(eq(signals.marketId, marketId), gte(signals.collectedAt, cutoff))
    )
    .orderBy(desc(signals.collectedAt));
}

/**
 * Orders
 */
export async function insertOrder(order: InsertOrder) {
  const db = await getDb();
  if (!db) return;
  await db.insert(orders).values(order);
}

export async function getOrderByNonce(nonce: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.nonce, nonce))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getOpenOrders() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(
      inArray(orders.status, [
        "pending",
        "partially_filled",
        "cancel_requested",
      ])
    );
}

export async function getRecentOrders(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).orderBy(desc(orders.placedAt)).limit(limit);
}

export async function getClosedOrders(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(orders)
    .where(
      inArray(orders.status, ["filled", "cancelled", "expired", "rejected"])
    )
    .orderBy(desc(orders.placedAt))
    .limit(limit);
}

export async function getReconcilableOrders() {
  const db = await getDb();
  if (!db) return [];
  return getOpenOrders();
}

export async function updateOrderStatus(
  nonce: string,
  status:
    | "partially_filled"
    | "filled"
    | "cancel_requested"
    | "cancelled"
    | "expired"
    | "rejected"
) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const updateData: Record<string, unknown> = { status };
  if (status === "partially_filled")
    updateData.lifecycleState = "PARTIALLY_FILLED";
  if (status === "filled") updateData.filledAt = now;
  if (status === "filled") updateData.lifecycleState = "FILLED";
  if (status === "cancel_requested")
    updateData.lifecycleState = "CANCEL_REQUESTED";
  if (status === "cancelled") updateData.cancelledAt = now;
  if (status === "cancelled") updateData.lifecycleState = "CANCEL_CONFIRMED";
  if (status === "expired") updateData.lifecycleState = "EXPIRED";
  if (status === "rejected") updateData.lifecycleState = "REJECTED";
  await db.update(orders).set(updateData).where(eq(orders.nonce, nonce));
}

export async function markOrderAccepted(
  nonce: string,
  exchangeOrderId: string
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(orders)
    .set({
      exchangeOrderId,
      lifecycleState: "ACCEPTED_BY_CLOB",
      acceptedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .where(eq(orders.nonce, nonce));
}

export async function updateOrderSyncState(
  nonce: string,
  updates: {
    matchedSize?: string;
    status?:
      | "pending"
      | "partially_filled"
      | "filled"
      | "cancel_requested"
      | "cancelled"
      | "expired"
      | "rejected";
    lifecycleState?:
      | "INTENT_CREATED"
      | "ORDER_SIGNED"
      | "ORDER_POSTED"
      | "ACCEPTED_BY_CLOB"
      | "PARTIALLY_FILLED"
      | "FILLED"
      | "CANCEL_REQUESTED"
      | "CANCEL_CONFIRMED"
      | "EXPIRED"
      | "REJECTED"
      | "RECONCILIATION_MISMATCH";
    rejectionReason?: string | null;
  }
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(orders)
    .set({
      ...updates,
      lastSyncedAt: new Date(),
    })
    .where(eq(orders.nonce, nonce));
}

/**
 * Decision Audits
 */
export async function insertDecisionAudits(audits: InsertDecisionAudit[]) {
  const db = await getDb();
  if (!db || audits.length === 0) return;
  await db.insert(decisionAudits).values(audits);
}

export async function getRecentDecisionAudits(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(decisionAudits)
    .orderBy(desc(decisionAudits.createdAt))
    .limit(limit);
}

/**
 * Trades
 */
export async function insertTrade(trade: InsertTrade) {
  const db = await getDb();
  if (!db) return;
  await db.insert(trades).values(trade);
}

export async function getRecentTrades(limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trades).orderBy(desc(trades.filledAt)).limit(limit);
}

export async function getTradesByMarketId(
  marketId: string,
  tokenId?: string,
  limit: number = 100
) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(trades.marketId, marketId)];
  if (tokenId) {
    conditions.push(eq(trades.tokenId, tokenId));
  }

  return db
    .select()
    .from(trades)
    .where(and(...conditions))
    .orderBy(desc(trades.filledAt))
    .limit(limit);
}

/**
 * Equity Snapshots
 */
export async function insertEquitySnapshot(snapshot: InsertEquitySnapshot) {
  const db = await getDb();
  if (!db) return;
  await db.insert(equitySnapshots).values(snapshot);
}

export async function getLatestEquitySnapshot() {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(equitySnapshots)
    .orderBy(desc(equitySnapshots.timestamp))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getEquityHistory(hoursBack: number = 24) {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  return db
    .select()
    .from(equitySnapshots)
    .where(gte(equitySnapshots.timestamp, cutoff))
    .orderBy(equitySnapshots.timestamp);
}

export async function getExchangePortfolioState(now = new Date()) {
  const { getExchangePortfolioState: resolveExchangePortfolioState } =
    await import("./agent/portfolio-state");
  return resolveExchangePortfolioState(now);
}

/**
 * Bot Configuration
 */
export async function getBotConfig() {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(botConfig).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function initializeBotConfig(config: InsertBotConfig) {
  const db = await getDb();
  if (!db) return;
  const existing = await getBotConfig();
  if (!existing) {
    await db.insert(botConfig).values(config);
  }
}

export async function updateBotConfig(updates: Partial<InsertBotConfig>) {
  const db = await getDb();
  if (!db) return;
  await db.update(botConfig).set(updates);
}

/**
 * Bayesian Priors
 */
export async function getBayesianPrior(category: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(bayesianPriors)
    .where(eq(bayesianPriors.category, category))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertBayesianPrior(prior: InsertBayesianPrior) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(bayesianPriors)
    .values(prior)
    .onDuplicateKeyUpdate({
      set: {
        priorProbability: prior.priorProbability,
        sampleSize: prior.sampleSize,
        updatedAt: new Date(),
      },
    });
}
