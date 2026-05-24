import { sql } from "drizzle-orm";
import { getDb } from "../db";

export interface HistoricalEventEmbedding {
  eventId: string;
  summary: string;
  embedding: number[];
  anomalyType: string;
  marketMaker?: string;
  resolutionPattern?: string;
  outcome: "causal" | "coincidental" | "unknown";
  pnlUsd?: number;
}

export interface SimilarHistoricalEvent extends HistoricalEventEmbedding {
  similarity: number;
}

export interface VectorMemoryStore {
  searchByEmbedding(
    embedding: number[],
    options?: { topK?: number; anomalyType?: string }
  ): Promise<SimilarHistoricalEvent[]>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export class InMemoryVectorMemoryStore implements VectorMemoryStore {
  constructor(private readonly events: HistoricalEventEmbedding[]) {}

  async searchByEmbedding(
    embedding: number[],
    options: { topK?: number; anomalyType?: string } = {}
  ): Promise<SimilarHistoricalEvent[]> {
    const topK = options.topK ?? 5;
    return this.events
      .filter(
        event =>
          !options.anomalyType || event.anomalyType === options.anomalyType
      )
      .map(event => ({
        ...event,
        similarity: cosineSimilarity(embedding, event.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

// ─── DB-backed Vector Memory Store ──────────────────────────────────────────
// Embeddings are stored as JSON in MySQL. Cosine similarity is computed
// in-process after fetching candidates (MySQL has no native vector type).
// The CREATE TABLE is idempotent — safe to call on every startup.

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vector_memory (
  event_id VARCHAR(256) NOT NULL PRIMARY KEY,
  summary TEXT NOT NULL,
  embedding JSON NOT NULL,
  anomaly_type VARCHAR(128) NOT NULL,
  market_maker VARCHAR(256),
  resolution_pattern VARCHAR(256),
  outcome ENUM('causal','coincidental','unknown') NOT NULL DEFAULT 'unknown',
  pnl_usd DECIMAL(18,6),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_anomaly_type (anomaly_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`.trim();

interface VectorMemoryRow {
  event_id: string;
  summary: string;
  embedding: string;
  anomaly_type: string;
  market_maker: string | null;
  resolution_pattern: string | null;
  outcome: "causal" | "coincidental" | "unknown";
  pnl_usd: string | null;
}

export class DbVectorMemoryStore implements VectorMemoryStore {
  private migrated = false;

  private async ensureTable(): Promise<void> {
    if (this.migrated) return;
    const db = await getDb();
    if (!db) return;
    await db.execute(sql.raw(CREATE_TABLE_SQL));
    this.migrated = true;
  }

  async upsert(event: HistoricalEventEmbedding): Promise<void> {
    await this.ensureTable();
    const db = await getDb();
    if (!db) return;
    await db.execute(
      sql`INSERT INTO vector_memory
            (event_id, summary, embedding, anomaly_type, market_maker, resolution_pattern, outcome, pnl_usd)
          VALUES (
            ${event.eventId}, ${event.summary}, ${JSON.stringify(event.embedding)},
            ${event.anomalyType}, ${event.marketMaker ?? null}, ${event.resolutionPattern ?? null},
            ${event.outcome}, ${event.pnlUsd ?? null}
          )
          ON DUPLICATE KEY UPDATE
            summary = VALUES(summary), embedding = VALUES(embedding),
            anomaly_type = VALUES(anomaly_type), market_maker = VALUES(market_maker),
            resolution_pattern = VALUES(resolution_pattern), outcome = VALUES(outcome),
            pnl_usd = VALUES(pnl_usd), updated_at = CURRENT_TIMESTAMP`
    );
  }

  async searchByEmbedding(
    embedding: number[],
    options: { topK?: number; anomalyType?: string } = {}
  ): Promise<SimilarHistoricalEvent[]> {
    await this.ensureTable();
    const db = await getDb();
    if (!db) return [];

    const topK = options.topK ?? 5;
    const rows = await db.execute(
      options.anomalyType
        ? sql`SELECT * FROM vector_memory WHERE anomaly_type = ${options.anomalyType}`
        : sql`SELECT * FROM vector_memory`
    );

    const rawRows = (Array.isArray(rows)
      ? rows[0]
      : rows) as unknown as VectorMemoryRow[];

    return rawRows
      .map(row => {
        const rowEmbedding = JSON.parse(row.embedding) as number[];
        return {
          eventId: row.event_id,
          summary: row.summary,
          embedding: rowEmbedding,
          anomalyType: row.anomaly_type,
          marketMaker: row.market_maker ?? undefined,
          resolutionPattern: row.resolution_pattern ?? undefined,
          outcome: row.outcome,
          pnlUsd: row.pnl_usd != null ? Number(row.pnl_usd) : undefined,
          similarity: cosineSimilarity(embedding, rowEmbedding),
        } satisfies SimilarHistoricalEvent;
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

export function buildStructuralEmbedding(input: {
  anomalyScore: number;
  probabilityGap: number;
  liquidity: number;
  volume24h: number;
  spread: number;
  hoursToExpiry: number;
}): number[] {
  return [
    input.anomalyScore,
    input.probabilityGap,
    Math.log10(Math.max(1, input.liquidity)) / 6,
    Math.log10(Math.max(1, input.volume24h)) / 7,
    input.spread,
    Math.min(1, input.hoursToExpiry / 720),
  ];
}
