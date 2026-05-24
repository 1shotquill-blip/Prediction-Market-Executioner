CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS persistent_memory (
    id SERIAL PRIMARY KEY,
    market_id TEXT NOT NULL,
    conditions JSONB NOT NULL,
    outcome_realized BOOLEAN NOT NULL,
    pnl_usd NUMERIC NOT NULL,
    embedding VECTOR(1536), -- Standard size for common embedding models
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS memory_embedding_idx ON persistent_memory 
USING ivfflat (embedding vector_cosine_ops);
