import {
  decimal,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Polymarket markets tracked by the bot.
 */
export const markets = mysqlTable(
  "markets",
  {
    id: int("id").autoincrement().primaryKey(),
    marketId: varchar("marketId", { length: 256 }).notNull().unique(),
    question: text("question").notNull(),
    category: varchar("category", { length: 100 }),
    volume24h: decimal("volume24h", { precision: 18, scale: 6 }),
    bestBid: decimal("bestBid", { precision: 10, scale: 6 }),
    bestAsk: decimal("bestAsk", { precision: 10, scale: 6 }),
    spread: decimal("spread", { precision: 10, scale: 6 }),
    expiresAt: timestamp("expiresAt"),
    lastUpdatedAt: timestamp("lastUpdatedAt")
      .defaultNow()
      .onUpdateNow()
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("idx_marketId").on(t.marketId),
    index("idx_category").on(t.category),
  ]
);

export type Market = typeof markets.$inferSelect;
export type InsertMarket = typeof markets.$inferInsert;

/**
 * External signals (news, sentiment, tweets) for each market.
 */
export const signals = mysqlTable(
  "signals",
  {
    id: int("id").autoincrement().primaryKey(),
    marketId: varchar("marketId", { length: 256 }).notNull(),
    source: varchar("source", { length: 50 }).notNull(), // 'news', 'twitter', 'sentiment'
    content: text("content"),
    sentimentScore: decimal("sentimentScore", { precision: 3, scale: 2 }),
    confidence: decimal("confidence", { precision: 3, scale: 2 }),
    metadata: json("metadata"),
    collectedAt: timestamp("collectedAt").defaultNow().notNull(),
  },
  t => [
    index("idx_marketId_signals").on(t.marketId),
    index("idx_source").on(t.source),
  ]
);

export type Signal = typeof signals.$inferSelect;
export type InsertSignal = typeof signals.$inferInsert;

/**
 * All orders placed by the bot (pending, filled, cancelled).
 */
export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    nonce: varchar("nonce", { length: 256 }).notNull().unique(),
    exchangeOrderId: varchar("exchangeOrderId", { length: 256 }),
    marketId: varchar("marketId", { length: 256 }).notNull(),
    tokenId: varchar("tokenId", { length: 256 }).notNull(),
    side: mysqlEnum("side", ["buy", "sell"]).notNull(),
    price: decimal("price", { precision: 10, scale: 6 }).notNull(),
    size: decimal("size", { precision: 18, scale: 6 }).notNull(),
    matchedSize: decimal("matchedSize", { precision: 18, scale: 6 })
      .default("0")
      .notNull(),
    status: mysqlEnum("status", [
      "pending",
      "partially_filled",
      "filled",
      "cancel_requested",
      "cancelled",
      "expired",
      "rejected",
    ])
      .default("pending")
      .notNull(),
    lifecycleState: mysqlEnum("lifecycleState", [
      "INTENT_CREATED",
      "ORDER_SIGNED",
      "ORDER_POSTED",
      "ACCEPTED_BY_CLOB",
      "PARTIALLY_FILLED",
      "FILLED",
      "CANCEL_REQUESTED",
      "CANCEL_CONFIRMED",
      "EXPIRED",
      "REJECTED",
      "RECONCILIATION_MISMATCH",
    ])
      .default("INTENT_CREATED")
      .notNull(),
    edgeAtPlacement: decimal("edgeAtPlacement", { precision: 10, scale: 6 }),
    confidenceAtPlacement: decimal("confidenceAtPlacement", {
      precision: 3,
      scale: 2,
    }),
    rejectionReason: text("rejectionReason"),
    placedAt: timestamp("placedAt").defaultNow().notNull(),
    acceptedAt: timestamp("acceptedAt"),
    filledAt: timestamp("filledAt"),
    lastSyncedAt: timestamp("lastSyncedAt"),
    cancelledAt: timestamp("cancelledAt"),
    expiresAt: timestamp("expiresAt"),
  },
  t => [
    index("idx_marketId_orders").on(t.marketId),
    index("idx_nonce").on(t.nonce),
    index("idx_exchangeOrderId").on(t.exchangeOrderId),
    index("idx_status").on(t.status),
    index("idx_lifecycleState").on(t.lifecycleState),
  ]
);

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Every agent decision, including skips. This is the primary dataset for
 * improving win rate, expected value, calibration, and risk gates.
 */
export const decisionAudits = mysqlTable(
  "decision_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    tickId: varchar("tickId", { length: 128 }).notNull(),
    marketId: varchar("marketId", { length: 256 }).notNull(),
    question: text("question").notNull(),
    action: mysqlEnum("action", [
      "skipped",
      "paper_order_submitted",
      "live_order_submitted",
    ]).notNull(),
    reasons: json("reasons"),
    estimatedProbability: decimal("estimatedProbability", {
      precision: 10,
      scale: 6,
    }),
    confidence: decimal("confidence", { precision: 3, scale: 2 }),
    edge: decimal("edge", { precision: 10, scale: 6 }),
    bestBid: decimal("bestBid", { precision: 10, scale: 6 }),
    bestAsk: decimal("bestAsk", { precision: 10, scale: 6 }),
    spread: decimal("spread", { precision: 10, scale: 6 }),
    selectionScore: decimal("selectionScore", { precision: 10, scale: 6 }),
    orderNonce: varchar("orderNonce", { length: 256 }),
    exchangeOrderId: varchar("exchangeOrderId", { length: 256 }),
    lifecycleStatus: varchar("lifecycleStatus", { length: 64 }),
    diagnostics: json("diagnostics"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => [
    index("idx_decision_tickId").on(t.tickId),
    index("idx_decision_marketId").on(t.marketId),
    index("idx_decision_action").on(t.action),
    index("idx_decision_createdAt").on(t.createdAt),
  ]
);

export type DecisionAudit = typeof decisionAudits.$inferSelect;
export type InsertDecisionAudit = typeof decisionAudits.$inferInsert;

/**
 * Executed trades (filled orders with final P&L).
 */
export const trades = mysqlTable(
  "trades",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull(),
    marketId: varchar("marketId", { length: 256 }).notNull(),
    tokenId: varchar("tokenId", { length: 256 }).notNull(),
    side: mysqlEnum("side", ["buy", "sell"]).notNull(),
    price: decimal("price", { precision: 10, scale: 6 }).notNull(),
    size: decimal("size", { precision: 18, scale: 6 }).notNull(),
    usdcValue: decimal("usdcValue", { precision: 18, scale: 6 }).notNull(),
    edgeAtTrade: decimal("edgeAtTrade", { precision: 10, scale: 6 }),
    confidenceAtTrade: decimal("confidenceAtTrade", { precision: 3, scale: 2 }),
    filledAt: timestamp("filledAt").defaultNow().notNull(),
  },
  t => [
    index("idx_marketId_trades").on(t.marketId),
    index("idx_orderId").on(t.orderId),
  ]
);

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * Periodic equity snapshots for P&L tracking and drawdown calculation.
 */
export const equitySnapshots = mysqlTable(
  "equity_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    balance: decimal("balance", { precision: 18, scale: 6 }).notNull(),
    peakBalance: decimal("peakBalance", { precision: 18, scale: 6 }).notNull(),
    drawdown: decimal("drawdown", { precision: 5, scale: 2 }).notNull(), // percentage
    totalExposure: decimal("totalExposure", {
      precision: 5,
      scale: 2,
    }).notNull(), // percentage
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  t => [index("idx_timestamp").on(t.timestamp)]
);

export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type InsertEquitySnapshot = typeof equitySnapshots.$inferInsert;

/**
 * Bot configuration and state (execution mode, thresholds, pause/resume).
 */
export const botConfig = mysqlTable("bot_config", {
  id: int("id").autoincrement().primaryKey(),
  executionMode: mysqlEnum("executionMode", ["paper", "live"])
    .default("paper")
    .notNull(),
  isRunning: int("isRunning").default(1).notNull(), // 1 = true, 0 = false
  isPaused: int("isPaused").default(0).notNull(),
  emergencyBrakeTriggered: int("emergencyBrakeTriggered").default(0).notNull(),
  edgeThreshold: decimal("edgeThreshold", { precision: 10, scale: 6 })
    .default("0.05")
    .notNull(),
  kellyFraction: decimal("kellyFraction", { precision: 3, scale: 2 })
    .default("0.25")
    .notNull(),
  maxSpread: decimal("maxSpread", { precision: 10, scale: 6 })
    .default("0.05")
    .notNull(),
  maxSingleExposure: decimal("maxSingleExposure", { precision: 5, scale: 2 })
    .default("5")
    .notNull(), // percentage
  maxTotalExposure: decimal("maxTotalExposure", { precision: 5, scale: 2 })
    .default("30")
    .notNull(), // percentage
  drawdownLimit: decimal("drawdownLimit", { precision: 5, scale: 2 })
    .default("15")
    .notNull(), // percentage
  minVolume24h: decimal("minVolume24h", { precision: 18, scale: 6 })
    .default("1000")
    .notNull(),
  minConfidence: decimal("minConfidence", { precision: 3, scale: 2 })
    .default("0.6")
    .notNull(),
  orderTimeoutSeconds: int("orderTimeoutSeconds").default(30).notNull(),
  pollingIntervalSeconds: int("pollingIntervalSeconds").default(15).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = typeof botConfig.$inferInsert;

/**
 * Bayesian priors by market category for probability estimation.
 */
export const bayesianPriors = mysqlTable(
  "bayesian_priors",
  {
    id: int("id").autoincrement().primaryKey(),
    category: varchar("category", { length: 100 }).notNull().unique(),
    priorProbability: decimal("priorProbability", {
      precision: 3,
      scale: 2,
    }).notNull(),
    sampleSize: int("sampleSize").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  t => [index("idx_category_priors").on(t.category)]
);

export type BayesianPrior = typeof bayesianPriors.$inferSelect;
export type InsertBayesianPrior = typeof bayesianPriors.$inferInsert;
