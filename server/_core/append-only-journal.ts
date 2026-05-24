/**
 * APPEND-ONLY EXECUTION JOURNAL
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Immutable audit trail for:
 * - Execution lifecycle tracking
 * - Replay-safe recovery
 * - Regulatory compliance
 * - Black-swan analysis
 * - Trade forensics
 */

import { Database } from "better-sqlite3";
import IORedis from "ioredis";

export interface JournalEntry {
  id: string;
  executionId: string;
  correlationId: string;
  clientOrderId: string;
  marketId: string;
  exchange: string;
  event: string;
  fromPhase?: string;
  toPhase?: string;
  timestamp: Date;
  reason?: string;
  matchedSizeUsd?: number;
  remainingSizeUsd?: number;
  exchangeOrderId?: string;
  portfolioMetrics?: Record<string, number>;
  riskMetrics?: Record<string, number>;
  metadata?: Record<string, unknown>;
}

class AppendOnlyJournal {
  private db: Database;
  private redis: IORedis;
  private readonly RETENTION_DAYS = 90;

  constructor(dbPath: string) {
    const sqlite3 = require("better-sqlite3");
    this.db = new sqlite3(dbPath);
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || "6379"),
      db: 2, // Separate DB for journal cache
    });

    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS execution_journal (
        id TEXT PRIMARY KEY,
        executionId TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        clientOrderId TEXT NOT NULL,
        marketId TEXT NOT NULL,
        exchange TEXT NOT NULL,
        event TEXT NOT NULL,
        fromPhase TEXT,
        toPhase TEXT,
        timestamp DATETIME NOT NULL,
        reason TEXT,
        matchedSizeUsd REAL,
        remainingSizeUsd REAL,
        exchangeOrderId TEXT,
        portfolioMetrics JSON,
        riskMetrics JSON,
        metadata JSON,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_executionId ON execution_journal (executionId);
      CREATE INDEX IF NOT EXISTS idx_correlationId ON execution_journal (correlationId);
      CREATE INDEX IF NOT EXISTS idx_clientOrderId ON execution_journal (clientOrderId);
      CREATE INDEX IF NOT EXISTS idx_marketId ON execution_journal (marketId);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON execution_journal (timestamp);
    `);

    // Create retention policy table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS journal_retention (
        id INTEGER PRIMARY KEY,
        executionId TEXT UNIQUE,
        expiresAt DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_expiresAt ON journal_retention (expiresAt);
    `);
  }

  /**
   * Append immutable journal entry (no updates allowed)
   */
  async append(entry: Omit<JournalEntry, "id" | "createdAt">): Promise<string> {
    const { nanoid } = await import("nanoid");
    const id = nanoid(16);
    const timestamp = new Date();

    const stmt = this.db.prepare(`
      INSERT INTO execution_journal (
        id, executionId, correlationId, clientOrderId, marketId, exchange,
        event, fromPhase, toPhase, timestamp, reason, matchedSizeUsd,
        remainingSizeUsd, exchangeOrderId, portfolioMetrics, riskMetrics, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.executionId,
      entry.correlationId,
      entry.clientOrderId,
      entry.marketId,
      entry.exchange,
      entry.event,
      entry.fromPhase,
      entry.toPhase,
      timestamp.toISOString(),
      entry.reason,
      entry.matchedSizeUsd,
      entry.remainingSizeUsd,
      entry.exchangeOrderId,
      JSON.stringify(entry.portfolioMetrics || {}),
      JSON.stringify(entry.riskMetrics || {}),
      JSON.stringify(entry.metadata || {})
    );

    // Cache in Redis for hot access
    await this.redis.setex(
      `journal:${id}`,
      86400, // 1 day TTL
      JSON.stringify({ id, ...entry, timestamp })
    );

    return id;
  }

  /**
   * Get execution history (immutable, ordered by timestamp)
   */
  async getExecutionHistory(
    executionId: string
  ): Promise<JournalEntry[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_journal
      WHERE executionId = ?
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all(executionId) as any[];
    return rows.map((row) => this.parseJournalRow(row));
  }

  /**
   * Get correlation chain (all related executions)
   */
  async getCorrelationChain(
    correlationId: string
  ): Promise<JournalEntry[]> {
    const stmt = this.db.prepare(`
      SELECT DISTINCT executionId FROM execution_journal
      WHERE correlationId = ?
    `);

    const executions = stmt.all(correlationId) as any[];
    const allEntries: JournalEntry[] = [];

    for (const { executionId } of executions) {
      const history = await this.getExecutionHistory(executionId);
      allEntries.push(...history);
    }

    return allEntries.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
  }

  /**
   * Reconstruct execution state from journal
   */
  async reconstructExecutionState(executionId: string): Promise<any> {
    const history = await this.getExecutionHistory(executionId);
    if (history.length === 0) return null;

    const current = history[history.length - 1];
    return {
      executionId,
      phase: current.toPhase,
      matchedSizeUsd: current.matchedSizeUsd || 0,
      remainingSizeUsd: current.remainingSizeUsd || 0,
      history,
    };
  }

  /**
   * Audit trail query for compliance
   */
  async getAuditTrail(
    startDate: Date,
    endDate: Date,
    filters?: {
      exchange?: string;
      marketId?: string;
      event?: string;
    }
  ): Promise<JournalEntry[]> {
    let query = `
      SELECT * FROM execution_journal
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const params: any[] = [startDate.toISOString(), endDate.toISOString()];

    if (filters?.exchange) {
      query += ` AND exchange = ?`;
      params.push(filters.exchange);
    }
    if (filters?.marketId) {
      query += ` AND marketId = ?`;
      params.push(filters.marketId);
    }
    if (filters?.event) {
      query += ` AND event = ?`;
      params.push(filters.event);
    }

    query += ` ORDER BY timestamp DESC`;
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => this.parseJournalRow(row));
  }

  /**
   * Enforce retention policy
   */
  async enforceRetention(): Promise<void> {
    const cutoffDate = new Date(
      Date.now() - this.RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    const stmt = this.db.prepare(`
      DELETE FROM execution_journal
      WHERE timestamp < ?
    `);

    stmt.run(cutoffDate.toISOString());
    console.log(`[Journal] Enforced retention policy (cutoff: ${cutoffDate})`);
  }

  private parseJournalRow(row: any): JournalEntry {
    return {
      id: row.id,
      executionId: row.executionId,
      correlationId: row.correlationId,
      clientOrderId: row.clientOrderId,
      marketId: row.marketId,
      exchange: row.exchange,
      event: row.event,
      fromPhase: row.fromPhase,
      toPhase: row.toPhase,
      timestamp: new Date(row.timestamp),
      reason: row.reason,
      matchedSizeUsd: row.matchedSizeUsd,
      remainingSizeUsd: row.remainingSizeUsd,
      exchangeOrderId: row.exchangeOrderId,
      portfolioMetrics: JSON.parse(row.portfolioMetrics || "{}"),
      riskMetrics: JSON.parse(row.riskMetrics || "{}"),
      metadata: JSON.parse(row.metadata || "{}"),
    };
  }

  async close(): Promise<void> {
    this.db.close();
    await this.redis.quit();
  }
}

export const appendOnlyJournal = new AppendOnlyJournal(
  process.env.JOURNAL_DB_PATH || "./execution-journal.db"
);
