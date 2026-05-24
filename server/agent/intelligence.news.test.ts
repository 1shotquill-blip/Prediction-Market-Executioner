import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvokeLLM = vi.fn();
const mockIngestNewsForQueries = vi.fn();
const mockBuildCategoryCalibrationContext = vi.fn();
const mockCalibrateProbability = vi.fn((probability: number) => probability);
const mockCalibrateConfidence = vi.fn((confidence: number) => confidence);
const mockDescribeCalibrationContext = vi.fn(
  (context: {
    priorProbability?: number;
    priorSampleSize: number;
    confidenceFloor: number;
    blendWeight: number;
  }) =>
    `category prior probability: ${context.priorProbability?.toFixed(3) ?? "n/a"}, prior sample size: ${context.priorSampleSize}, confidence floor: ${context.confidenceFloor.toFixed(2)}, prior blend weight: ${context.blendWeight.toFixed(2)}`
);

vi.mock("../_core/llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../intelligence/news-ingestion", () => ({
  ingestNewsForQueries: mockIngestNewsForQueries,
}));
vi.mock("../intelligence/calibration", () => ({
  buildCategoryCalibrationContext: mockBuildCategoryCalibrationContext,
  calibrateProbability: mockCalibrateProbability,
  calibrateConfidence: mockCalibrateConfidence,
  describeCalibrationContext: mockDescribeCalibrationContext,
}));

const { LLMIntelligenceEngine } = await import("./intelligence");

function createLLMResponse(payload: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  };
}

describe("LLM intelligence with news context", () => {
  beforeEach(() => {
    mockInvokeLLM.mockReset();
    mockIngestNewsForQueries.mockReset();
    mockBuildCategoryCalibrationContext.mockReset();
    mockCalibrateProbability.mockClear();
    mockCalibrateConfidence.mockClear();
    mockDescribeCalibrationContext.mockClear();
  });

  it("runs news ingestion between factor extraction and probability estimation", async () => {
    mockIngestNewsForQueries.mockResolvedValue([
      {
        source: "x",
        content: "BTC rallies on strong ETF inflows",
        timestamp: new Date("2026-05-09T00:00:00Z"),
        sentiment: 0.8,
      },
    ]);
    mockBuildCategoryCalibrationContext.mockResolvedValue({
      category: "crypto",
      priorProbability: 0.55,
      priorSampleSize: 40,
      confidenceFloor: 0.6,
      blendWeight: 0.2,
    });
    const estimationResponse = createLLMResponse({
      outcome: "yes",
      probability: 0.72,
      confidence: 0.81,
      rationale: "Recent ETF news and momentum favor YES",
    });
    mockInvokeLLM.mockResolvedValueOnce(
      createLLMResponse({
        factors: ["ETF inflows are the key driver"],
        searchQueries: ["btc etf inflows"],
      })
    );
    // Three estimation calls — one per ensemble model.
    mockInvokeLLM.mockResolvedValueOnce(estimationResponse);
    mockInvokeLLM.mockResolvedValueOnce(estimationResponse);
    mockInvokeLLM.mockResolvedValueOnce(estimationResponse);

    const engine = new LLMIntelligenceEngine();
    const market = {
      marketId: "m-1",
      question: "Will BTC trade above $100k by Friday?",
      yesTokenId: "yes-token",
      noTokenId: "no-token",
      bestBid: 0.58,
      bestAsk: 0.6,
      spread: 0.02,
      midpoint: 0.59,
      volume24h: 100000,
      liquidity: 5000,
      expiresAt: new Date("2026-05-10T00:00:00Z"),
      orderbookUpdatedAt: new Date("2026-05-09T00:00:00Z"),
      category: "crypto",
    } as const;

    const decision = await engine.evaluate(
      market,
      new Date("2026-05-09T02:00:00Z")
    );

    expect(mockIngestNewsForQueries).toHaveBeenCalledWith(["btc etf inflows"], {
      now: expect.any(Date),
    });
    // 1 factor-extraction call + 3 ensemble estimation calls (one per model).
    expect(mockInvokeLLM).toHaveBeenCalledTimes(4);

    const probabilityCall = mockInvokeLLM.mock.calls[1]?.[0];
    expect(probabilityCall.messages[1].content).toContain(
      "News context (1 items):"
    );
    expect(probabilityCall.messages[1].content).toContain(
      "BTC rallies on strong ETF inflows"
    );
    expect(probabilityCall.messages[0].content).toContain(
      "Bayesian anchor: category prior probability: 0.550"
    );

    expect(decision?.estimatedProbability).toBeCloseTo(0.72, 5);
    expect(decision?.confidence).toBeCloseTo(0.81, 5);
    expect(decision?.estimates[0].evidence).toContain(
      "BTC rallies on strong ETF inflows"
    );
  });

  it("continues with LLM-only reasoning when news ingestion returns no items", async () => {
    mockIngestNewsForQueries.mockResolvedValue([]);
    mockBuildCategoryCalibrationContext.mockResolvedValue({
      category: "politics",
      priorProbability: 0.5,
      priorSampleSize: 10,
      confidenceFloor: 0.6,
      blendWeight: 0.1,
    });
    const est2 = createLLMResponse({
      outcome: "yes",
      probability: 0.61,
      confidence: 0.7,
      rationale: "No fresh news, but the vote schedule still supports YES",
    });
    mockInvokeLLM.mockResolvedValueOnce(
      createLLMResponse({
        factors: ["debate timing"],
        searchQueries: ["senate vote"],
      })
    );
    mockInvokeLLM.mockResolvedValueOnce(est2);
    mockInvokeLLM.mockResolvedValueOnce(est2);
    mockInvokeLLM.mockResolvedValueOnce(est2);

    const engine = new LLMIntelligenceEngine();
    const market = {
      marketId: "m-2",
      question: "Will the bill pass this week?",
      yesTokenId: "yes-token-2",
      noTokenId: "no-token-2",
      bestBid: 0.44,
      bestAsk: 0.46,
      spread: 0.02,
      midpoint: 0.45,
      volume24h: 50000,
      liquidity: 4000,
      expiresAt: new Date("2026-05-10T00:00:00Z"),
      orderbookUpdatedAt: new Date("2026-05-09T00:00:00Z"),
      category: "politics",
    } as const;

    const decision = await engine.evaluate(
      market,
      new Date("2026-05-09T02:00:00Z")
    );

    expect(mockIngestNewsForQueries).toHaveBeenCalled();
    expect(decision).not.toBeNull();
    expect(decision?.estimates[0].evidence.join(" ")).toContain(
      "No fresh news"
    );
  });
});
