import { describe, expect, it } from "vitest";
import {
  buildStructuralEmbedding,
  InMemoryVectorMemoryStore,
} from "./vector-retrieval";

describe("vector retrieval", () => {
  it("retrieves structurally similar historical events by cosine similarity", async () => {
    const embedding = buildStructuralEmbedding({
      anomalyScore: 0.8,
      probabilityGap: 0.25,
      liquidity: 20_000,
      volume24h: 200_000,
      spread: 0.02,
      hoursToExpiry: 48,
    });
    const store = new InMemoryVectorMemoryStore([
      {
        eventId: "close",
        summary: "similar anomaly",
        embedding,
        anomalyType: "divergence",
        outcome: "causal",
      },
      {
        eventId: "far",
        summary: "different anomaly",
        embedding: [0, 0, 0, 1, 1, 1],
        anomalyType: "divergence",
        outcome: "unknown",
      },
    ]);

    const [first] = await store.searchByEmbedding(embedding, {
      topK: 1,
      anomalyType: "divergence",
    });

    expect(first.eventId).toBe("close");
    expect(first.similarity).toBeCloseTo(1);
  });
});
