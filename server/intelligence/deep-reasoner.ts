import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import { getClobReferencePrice } from "../agent/book-pricing";
import type { AgentMarket, EnsembleDecision } from "../agent/types";
import type { AnomalyScanResult } from "./anomaly-scanner";
import type { SimilarHistoricalEvent } from "../memory/vector-retrieval";

export interface CatalystForecast {
  description: string;
  expectedAt: Date;
  expectedMovePct: number;
}

export interface DeepReasoningResult {
  marketId: string;
  confidence: number;
  fairPriceRange: {
    low: number;
    high: number;
  };
  expectedCorrectionPct: number;
  contrarianHypothesis: string;
  steelmanCurrentPrice: string;
  steelmanRebuttal: string;
  identifiedBlindSpot: string;
  catalyst: CatalystForecast;
  memoryMatches: SimilarHistoricalEvent[];
  generatedAt: Date;
}

export interface DeepReasoningInput {
  market: AgentMarket;
  decision: EnsembleDecision;
  anomaly: AnomalyScanResult;
  memoryMatches?: SimilarHistoricalEvent[];
  now?: Date;
}

export interface DeepReasoningProvider {
  reason(input: DeepReasoningInput): Promise<DeepReasoningResult | null>;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function parseReasoningPayload(
  payload: unknown,
  input: DeepReasoningInput,
  now: Date
): DeepReasoningResult | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const catalyst = value.catalyst as Record<string, unknown> | undefined;
  const expectedAt =
    typeof catalyst?.expectedAt === "string"
      ? new Date(catalyst.expectedAt)
      : new Date(now.getTime() + 86_400_000);

  if (Number.isNaN(expectedAt.getTime())) return null;

  return {
    marketId: input.market.marketId,
    confidence: clamp01(Number(value.confidence)),
    fairPriceRange: {
      low: clamp01(Number(value.fairPriceLow)),
      high: clamp01(Number(value.fairPriceHigh)),
    },
    expectedCorrectionPct: Math.max(0, Number(value.expectedCorrectionPct)),
    contrarianHypothesis: String(value.contrarianHypothesis ?? ""),
    steelmanCurrentPrice: String(value.steelmanCurrentPrice ?? ""),
    steelmanRebuttal: String(value.steelmanRebuttal ?? ""),
    identifiedBlindSpot: String(value.identifiedBlindSpot ?? ""),
    catalyst: {
      description: String(catalyst?.description ?? ""),
      expectedAt,
      expectedMovePct: Math.max(0, Number(catalyst?.expectedMovePct)),
    },
    memoryMatches: input.memoryMatches ?? [],
    generatedAt: now,
  };
}

function buildPrompt(input: DeepReasoningInput): string {
  const { market, decision, anomaly, memoryMatches = [] } = input;
  const referencePrice = getClobReferencePrice(market);
  const referencePriceLabel = Number.isFinite(referencePrice)
    ? referencePrice.toFixed(4)
    : "n/a";
  return [
    "You are a hyper-rational prediction-market analyst. Treat the market as an adversarial puzzle, not as a popularity contest.",
    "",
    "Market:",
    `Question: ${market.question}`,
    `Resolution criteria: ${market.resolutionCriteria ?? "not supplied"}`,
    `Current CLOB reference price: ${referencePriceLabel}`,
    `Best bid: ${market.bestBid}`,
    `Best ask: ${market.bestAsk}`,
    `Model probability: ${decision.estimatedProbability}`,
    `Model confidence: ${decision.confidence}`,
    `Anomaly score: ${anomaly.totalScore}`,
    "",
    "Structurally similar historical events:",
    ...memoryMatches.map(
      (match, index) =>
        `${index + 1}. ${match.eventId}: ${match.summary} similarity=${match.similarity.toFixed(3)} outcome=${match.outcome}`
    ),
    "",
    "Return strict JSON with: contrarianHypothesis, steelmanCurrentPrice, steelmanRebuttal, identifiedBlindSpot, fairPriceLow, fairPriceHigh, confidence, expectedCorrectionPct, catalyst { description, expectedAt, expectedMovePct }.",
    "The analysis must explicitly quantify the evidence-to-price gap and name the future catalyst that should force repricing.",
  ].join("\n");
}

export class OllamaDeepReasoningProvider implements DeepReasoningProvider {
  constructor(
    private readonly host = ENV.ollamaHost,
    private readonly model = ENV.llmReasonerModel
  ) {}

  async reason(input: DeepReasoningInput): Promise<DeepReasoningResult | null> {
    const now = input.now ?? new Date();
    const t0 = Date.now();
    const prompt = buildPrompt(input);

    // Try Ollama Cloud first (authenticated), then fall back via invokeLLM chain
    if (ENV.ollamaApiKey) {
      try {
        const response = await fetch(
          `${this.host.replace(/\/$/, "")}/api/chat`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${ENV.ollamaApiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              stream: false,
              format: "json",
              messages: [
                {
                  role: "system",
                  content:
                    "Run a four-stage reflection chain: contrarian hypothesis, steelman opposing view, evidence-to-price gap quantification, and catalyst identification. Do not recommend a trade unless the anomaly is genuinely non-obvious and evidence-backed.",
                },
                { role: "user", content: prompt },
              ],
            }),
          }
        );

        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(
            `Ollama deep reasoning ${response.status}: ${raw.slice(0, 200)}`
          );
        }

        const body = (await response.json()) as {
          message?: { content?: string };
        };
        const content = body.message?.content;
        if (!content) return null;
        const result = parseReasoningPayload(JSON.parse(content), input, now);
        console.log(
          `[Intelligence] deep reasoner: ${this.model} → contrarian="${result?.contrarianHypothesis?.slice(0, 60) ?? "none"}" (${Date.now() - t0}ms)`
        );
        return result;
      } catch (err) {
        console.warn(
          `[DeepReasoner] Ollama Cloud failed, falling back via invokeLLM chain: ${String(err).slice(0, 120)}`
        );
      }
    }

    // Fallback: use the standard invokeLLM fallback chain
    const result = await invokeLLM(
      {
        messages: [
          {
            role: "system",
            content:
              "Run a four-stage reflection chain: contrarian hypothesis, steelman opposing view, evidence-to-price gap quantification, and catalyst identification. Do not recommend a trade unless the anomaly is genuinely non-obvious and evidence-backed.",
          },
          { role: "user", content: prompt },
        ],
        responseFormat: { type: "json_object" },
      },
      this.model
    );

    const text =
      typeof result.choices[0].message.content === "string"
        ? result.choices[0].message.content
        : (
            result.choices[0].message.content as Array<{
              type: string;
              text?: string;
            }>
          )
            .filter(c => c.type === "text")
            .map(c => c.text ?? "")
            .join("");

    const parsed = parseReasoningPayload(JSON.parse(text), input, now);
    console.log(
      `[Intelligence] deep reasoner: ${this.model} (fallback) → contrarian="${parsed?.contrarianHypothesis?.slice(0, 60) ?? "none"}" (${Date.now() - t0}ms)`
    );
    return parsed;
  }
}

export class StaticDeepReasoningProvider implements DeepReasoningProvider {
  constructor(
    private readonly result: Omit<DeepReasoningResult, "generatedAt">
  ) {}

  async reason(input: DeepReasoningInput): Promise<DeepReasoningResult> {
    return {
      ...this.result,
      marketId: input.market.marketId,
      memoryMatches: input.memoryMatches ?? this.result.memoryMatches,
      generatedAt: input.now ?? new Date(),
    };
  }
}

export class DeepReasoner {
  constructor(private readonly provider: DeepReasoningProvider) {}

  async evaluate(
    input: DeepReasoningInput
  ): Promise<DeepReasoningResult | null> {
    const result = await this.provider.reason(input);
    if (!result) return null;
    if (result.fairPriceRange.low > result.fairPriceRange.high) return null;
    if (
      !result.contrarianHypothesis ||
      !result.steelmanCurrentPrice ||
      !result.steelmanRebuttal ||
      !result.identifiedBlindSpot ||
      !result.catalyst.description
    ) {
      return null;
    }
    return result;
  }
}
