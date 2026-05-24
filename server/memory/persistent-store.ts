import { Pool } from "pg";
import { ENV } from "../_core/env";

const pool = new Pool({ connectionString: ENV.databaseUrl });

export interface MemoryRecord {
  marketId: string;
  conditions: Record<string, any>;
  outcomeRealized: boolean;
  pnlUsd: number;
  embedding: number[];
}

export async function storeMemory(record: MemoryRecord) {
  const query = `
    INSERT INTO persistent_memory (market_id, conditions, outcome_realized, pnl_usd, embedding)
    VALUES (, , , , )
  `;
  await pool.query(query, [
    record.marketId,
    JSON.stringify(record.conditions),
    record.outcomeRealized,
    record.pnlUsd,
    record.embedding,
  ]);
}

export async function retrieveSimilarExperiences(
  embedding: number[],
  limit = 5
) {
  // Use pgvector cosine similarity search
  const query = `
    SELECT market_id, conditions, pnl_usd,
    1 - (embedding <=> ) AS similarity
    FROM persistent_memory
    ORDER BY similarity DESC
    LIMIT 
  `;
  const { rows } = await pool.query(query, [embedding, limit]);
  return rows;
}
