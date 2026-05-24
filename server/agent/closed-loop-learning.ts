import { getRecentTrades } from "../db";
import {
  DbVectorMemoryStore,
  buildStructuralEmbedding,
} from "../memory/vector-retrieval";
import type { HistoricalEventEmbedding } from "../memory/vector-retrieval";

const store = new DbVectorMemoryStore();

/**
 * Scan recent resolved trades and upsert outcome embeddings into vector memory.
 * Called periodically by the bot engine so the deep-reasoner can learn from history.
 */
export async function feedTradeOutcomesToMemory(): Promise<void> {
  let trades: Awaited<ReturnType<typeof getRecentTrades>>;
  try {
    trades = await getRecentTrades(50);
  } catch {
    return;
  }

  for (const trade of trades) {
    // Only index trades where we know the outcome (pnl captured in usdcValue)
    const filledSize = Number(trade.size ?? 0);
    const cost = Number(trade.price ?? 0) * filledSize;
    const proceeds = Number(trade.usdcValue ?? 0);
    if (filledSize === 0 || proceeds === 0) continue;

    const pnlUsd = proceeds - cost;
    const outcome: HistoricalEventEmbedding["outcome"] =
      pnlUsd > 0 ? "causal" : "coincidental";

    const embedding = buildStructuralEmbedding({
      anomalyScore: 0.5,
      probabilityGap: Math.abs(Number(trade.price ?? 0) - 0.5),
      liquidity: filledSize * 100,
      volume24h: filledSize * 200,
      spread: 0.04,
      hoursToExpiry: 24,
    });

    const eventId = `trade-${trade.id ?? trade.marketId}-${trade.filledAt ? new Date(trade.filledAt).getTime() : Date.now()}`;

    await store
      .upsert({
        eventId,
        summary: `Market ${trade.marketId} side=${trade.side} size=${filledSize} price=${trade.price} pnl=${pnlUsd.toFixed(4)}`,
        embedding,
        anomalyType: "trade_outcome",
        outcome,
        pnlUsd,
      })
      .catch(() => {});
  }
}

/**
 * Build a "Lessons Learned" string for injection into the deep-reasoner prompt.
 * Returns the top-K most similar historical outcomes for the current market context.
 */
export async function buildLessonsLearned(context: {
  anomalyScore: number;
  probabilityGap: number;
  liquidity: number;
  volume24h: number;
  spread: number;
  hoursToExpiry: number;
}): Promise<string> {
  try {
    const embedding = buildStructuralEmbedding(context);
    const similar = await store.searchByEmbedding(embedding, {
      topK: 5,
      anomalyType: "trade_outcome",
    });

    if (similar.length === 0) return "";

    const lines = similar.map(e => {
      const tag = e.outcome === "causal" ? "WIN" : "LOSS";
      const pnl = e.pnlUsd != null ? ` pnl=$${e.pnlUsd.toFixed(2)}` : "";
      return `[${tag}${pnl} sim=${e.similarity.toFixed(2)}] ${e.summary}`;
    });

    return `\nLessons Learned from similar past trades:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}
