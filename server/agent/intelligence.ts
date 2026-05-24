import {
  invokeLLM,
  invokeLLMWithChain,
  buildCloudProviderChain,
} from "../_core/llm";
import { buildLessonsLearned } from "./closed-loop-learning";
import { ENV } from "../_core/env";
import {
  buildCategoryCalibrationContext,
  calibrateConfidence,
  calibrateProbability,
  describeCalibrationContext,
  type CategoryCalibrationContext,
} from "../intelligence/calibration";
import {
  ingestNewsForQueries,
  type NewsSignal,
} from "../intelligence/news-ingestion";
import { searchTweets } from "../intelligence/x-ingestion";
import { getClobReferencePrice } from "./book-pricing";
import type {
  AgentMarket,
  EnsembleDecision,
  OutcomeSide,
  ProbabilityEstimate,
  SocialSignal,
} from "./types";

export interface IntelligenceEngine {
  evaluate(market: AgentMarket, now?: Date): Promise<EnsembleDecision | null>;
}

export interface StaticProbabilityRule {
  marketId: string;
  probability: number;
  confidence: number;
  evidence: string[];
}

export class RuleBasedIntelligenceEngine implements IntelligenceEngine {
  private readonly rules: Map<string, StaticProbabilityRule>;

  constructor(rules: StaticProbabilityRule[] = []) {
    this.rules = new Map(rules.map(rule => [rule.marketId, rule]));
  }

  async evaluate(
    market: AgentMarket,
    now = new Date()
  ): Promise<EnsembleDecision | null> {
    const rule = this.rules.get(market.marketId);
    if (!rule) return null;

    const estimates: ProbabilityEstimate[] = [
      {
        source: "rule",
        probability: rule.probability,
        confidence: rule.confidence,
        evidence: rule.evidence,
        freshnessSeconds: 0,
      },
    ];

    return {
      marketId: market.marketId,
      outcome: "yes",
      estimatedProbability: rule.probability,
      confidence: rule.confidence,
      estimates,
      modelDisagreement: 0,
      evidenceSummary: rule.evidence,
      generatedAt: now,
    };
  }
}

// ─── LLM Intelligence Engine ────────────────────────────────────────────────
// Two-stage pipeline per the design doc:
//   1. Factor extraction  — fast call, identifies what drives the outcome
//   2. Probability estimation — structured JSON with p_est + confidence

interface FactorExtractionResult {
  factors: string[];
  searchQueries: string[];
}

interface ProbabilityEstimationResult {
  probability: number;
  confidence: number;
  rationale: string;
  outcome: OutcomeSide;
}

function formatMarketContext(market: AgentMarket): string {
  const hoursToExpiry = Math.round(
    (market.expiresAt.getTime() - Date.now()) / 3_600_000
  );
  const referencePrice = getClobReferencePrice(market);
  const referencePriceLabel = Number.isFinite(referencePrice)
    ? (referencePrice * 100).toFixed(1)
    : "n/a";
  return [
    `Question: ${market.question}`,
    market.resolutionCriteria
      ? `Resolution criteria: ${market.resolutionCriteria}`
      : "",
    `Category: ${market.category ?? "unknown"}`,
    `CLOB reference YES probability: ${referencePriceLabel}%`,
    `Best bid: ${(market.bestBid * 100).toFixed(1)}%  Best ask: ${(market.bestAsk * 100).toFixed(1)}%`,
    `24h volume: $${market.volume24h.toLocaleString()}`,
    `Liquidity: $${market.liquidity.toLocaleString()}`,
    `Hours to expiry: ${hoursToExpiry}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNewsContext(news: NewsSignal[]): string {
  if (news.length === 0) {
    return "News context: unavailable or no high-signal results.";
  }

  return [
    `News context (${news.length} items):`,
    ...news.slice(0, 12).map(item => {
      const sentiment = item.sentiment.toFixed(2);
      return `- [${item.source}] ${item.timestamp.toISOString()} sentiment=${sentiment} ${item.content}`;
    }),
  ].join("\n");
}

function formatSocialContext(socialSignals: SocialSignal[]): string {
  if (socialSignals.length === 0) {
    return "Recent social signal: unavailable or no qualifying tweets.";
  }

  return [
    `Recent social signal (${socialSignals.length} tweets):`,
    ...socialSignals
      .slice(0, 20)
      .map(tweet =>
        [
          `- @${tweet.author_username} ${tweet.created_at}`,
          `likes=${tweet.metrics.likes} retweets=${tweet.metrics.retweets} replies=${tweet.metrics.replies}`,
          typeof tweet.sentiment_score === "number"
            ? `sentiment=${tweet.sentiment_score.toFixed(2)}`
            : "sentiment=unavailable",
          tweet.text,
        ].join(" | ")
      ),
  ].join("\n");
}

async function extractFactors(
  market: AgentMarket
): Promise<FactorExtractionResult> {
  const model = ENV.llmExtractorModel;
  const t0 = Date.now();
  const result = await invokeLLM(
    {
      messages: [
        {
          role: "system",
          content: [
            "You are a prediction-market research assistant. Given a market, identify the 5–8 most important factors that will determine the outcome and produce targeted search queries for each.",
            "The searchQueries array should contain concise market-keyword queries suitable for X/Twitter and news search APIs.",
          ].join("\n"),
        },
        {
          role: "user",
          content: formatMarketContext(market),
        },
      ],
      outputSchema: {
        name: "factor_extraction",
        schema: {
          type: "object",
          properties: {
            factors: {
              type: "array",
              items: { type: "string" },
              description: "Key factors influencing the outcome",
            },
            searchQueries: {
              type: "array",
              items: { type: "string" },
              description: "Search queries to gather evidence",
            },
          },
          required: ["factors", "searchQueries"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    model
  );

  const text =
    typeof result.choices[0].message.content === "string"
      ? result.choices[0].message.content
      : result.choices[0].message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map(c => c.text)
          .join("");

  const parsed = JSON.parse(text) as FactorExtractionResult;
  console.log(
    `[Intelligence] stage 1: ${model} → ${parsed.factors.length} factors (${Date.now() - t0}ms)`
  );
  return parsed;
}

async function estimateProbability(
  market: AgentMarket,
  factors: string[],
  news: NewsSignal[],
  socialSignals: SocialSignal[],
  calibration?: CategoryCalibrationContext,
  model: string = ENV.llmPrimaryModel
): Promise<ProbabilityEstimationResult> {
  const t0 = Date.now();

  // Create an explicit chain for the estimate: Primary -> Secondary -> Fallback (API + Ollama)
  // This allows the engine to be truly provider-agnostic.
  const chain = buildCloudProviderChain();

  const result = await invokeLLMWithChain(
    chain,
    {
      messages: [
        {
          role: "system",
          content: [
            "You are an expert probabilistic forecaster for prediction markets.",
            "Your task: estimate the true probability that the YES outcome resolves.",
            "Rules:",
            "- Express probability as a decimal 0–1.",
            "- Confidence is certainty: 0=total uncertainty, 1=near-certain.",
            "- Be calibrated: edges must be well-supported.",
            calibration
              ? `- Bayesian anchor: ${describeCalibrationContext(calibration)}`
              : "- Bayesian anchor: unavailable",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            formatMarketContext(market),
            "",
            "Key factors:",
            ...factors.map((f, i) => `${i + 1}. ${f}`),
            "",
            formatNewsContext(news),
            "",
            formatSocialContext(socialSignals),
          ].join("\n"),
        },
      ],
      outputSchema: {
        name: "probability_estimation",
        schema: {
          type: "object",
          properties: {
            outcome: { type: "string", enum: ["yes", "no"] },
            probability: { type: "number" },
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["outcome", "probability", "confidence", "rationale"],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    model
  );

  const text =
    typeof result.choices[0].message.content === "string"
      ? result.choices[0].message.content
      : result.choices[0].message.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map(c => c.text)
          .join("");

  const parsed = JSON.parse(text) as ProbabilityEstimationResult;
  console.log(
    `[Intelligence] Estimate (${model}) → p=${parsed.probability.toFixed(3)}, c=${parsed.confidence.toFixed(3)} (${Date.now() - t0}ms)`
  );
  return parsed;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

interface MultiModelEstimateResult {
  estimatedProbability: number;
  confidence: number;
  modelDisagreement: number;
  estimates: ProbabilityEstimate[];
  primaryOutcome: OutcomeSide;
}

async function estimateProbabilityMultiModel(
  market: AgentMarket,
  factors: string[],
  news: NewsSignal[],
  socialSignals: SocialSignal[],
  calibration: CategoryCalibrationContext | undefined,
  freshnessSeconds: number
): Promise<MultiModelEstimateResult> {
  const models = [
    ENV.llmPrimaryModel,
    ENV.llmReasonerModel,
    ENV.llmEnsembleModel,
  ];

  const results = await Promise.allSettled(
    models.map(model =>
      estimateProbability(
        market,
        factors,
        news,
        socialSignals,
        calibration,
        model
      )
    )
  );

  type SuccessEntry = { model: string; est: ProbabilityEstimationResult };
  const successes: SuccessEntry[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      successes.push({ model: models[i], est: r.value });
    } else {
      console.warn(`[Intelligence] model ${models[i]} failed:`, r.reason);
    }
  });

  if (successes.length === 0) {
    throw new Error("[Intelligence] all models failed in ensemble");
  }

  const rawProbabilities = successes.map(({ est }) =>
    est.outcome === "no" ? 1 - est.probability : est.probability
  );
  const confidences = successes.map(({ est }) => est.confidence);

  const pMedian = median(rawProbabilities);
  const cMedian = median(confidences);

  // Max pairwise disagreement
  let maxDisagreement = 0;
  for (let i = 0; i < rawProbabilities.length; i++) {
    for (let j = i + 1; j < rawProbabilities.length; j++) {
      maxDisagreement = Math.max(
        maxDisagreement,
        Math.abs(rawProbabilities[i] - rawProbabilities[j])
      );
    }
  }

  const primarySuccess = successes[0];
  const primaryOutcome = primarySuccess.est.outcome;

  const estimates: ProbabilityEstimate[] = successes.map(({ model, est }) => {
    const p = est.outcome === "no" ? 1 - est.probability : est.probability;
    return {
      source: `llm:${model}`,
      probability: p,
      confidence: est.confidence,
      evidence: [est.rationale],
      freshnessSeconds,
    };
  });

  console.log(
    `[Intelligence] ensemble: models=${successes.length} p_median=${pMedian.toFixed(3)} disagreement=${maxDisagreement.toFixed(3)}`
  );

  return {
    estimatedProbability: pMedian,
    confidence: cMedian,
    modelDisagreement: maxDisagreement,
    estimates,
    primaryOutcome,
  };
}

async function collectSocialSignals(
  searchQueries: string[],
  lookbackHours = 6
): Promise<SocialSignal[]> {
  const uniqueQueries = Array.from(
    new Set(searchQueries.map(query => query.trim()).filter(Boolean))
  ).slice(0, 8);
  const batches = await Promise.all(
    uniqueQueries.map(query => searchTweets(query, lookbackHours))
  );
  const byId = new Map<string, SocialSignal>();
  for (const tweet of batches.flat()) byId.set(tweet.id, tweet);
  return Array.from(byId.values())
    .sort((a, b) => {
      const engagementA =
        a.metrics.likes + a.metrics.retweets * 2 + a.metrics.replies;
      const engagementB =
        b.metrics.likes + b.metrics.retweets * 2 + b.metrics.replies;
      return engagementB - engagementA;
    })
    .slice(0, 20);
}

export class LLMIntelligenceEngine implements IntelligenceEngine {
  async evaluate(
    market: AgentMarket,
    now = new Date()
  ): Promise<EnsembleDecision | null> {
    const callStart = Date.now();
    let factors: FactorExtractionResult;
    try {
      factors = await extractFactors(market);
    } catch (err) {
      console.error(
        `[Intelligence] Factor extraction failed for market ${market.marketId}:`,
        err
      );
      return null;
    }

    let news: NewsSignal[] = [];
    try {
      news = await ingestNewsForQueries(factors.searchQueries, {
        now,
      });
    } catch {
      console.warn(
        `[News] News ingestion failed for market ${market.marketId}; continuing with LLM-only reasoning`
      );
      news = [];
    }

    let socialSignals: SocialSignal[] = [];
    try {
      socialSignals = await collectSocialSignals(factors.searchQueries);
    } catch {
      console.warn(
        `[XIngestion] Social ingestion failed for market ${market.marketId}; continuing with LLM/news reasoning`
      );
      socialSignals = [];
    }

    let calibration: CategoryCalibrationContext | undefined;
    try {
      calibration = await buildCategoryCalibrationContext(market.category);
    } catch (err) {
      console.warn(
        `[Intelligence] Calibration unavailable for category ${market.category ?? "unknown"}:`,
        err
      );
      calibration = undefined;
    }

    const freshnessSeconds = (Date.now() - callStart) / 1000;

    let ensemble: MultiModelEstimateResult;
    try {
      ensemble = await estimateProbabilityMultiModel(
        market,
        factors.factors,
        news,
        socialSignals,
        calibration,
        freshnessSeconds
      );
    } catch (err) {
      console.error(
        `[Intelligence] Ensemble estimation failed for market ${market.marketId}:`,
        err
      );
      return null;
    }

    const rawProbability = clamp(ensemble.estimatedProbability, 0.01, 0.99);
    const rawConfidence = clamp(ensemble.confidence, 0, 1);

    const estimatedProbability = calibration
      ? calibrateProbability(rawProbability, calibration)
      : rawProbability;
    const confidence = calibration
      ? calibrateConfidence(rawConfidence, calibration)
      : rawConfidence;

    // Annotate the first estimate with full evidence (social signals, news, factors)
    const enrichedEstimates: ProbabilityEstimate[] = ensemble.estimates.map(
      (est, i) =>
        i === 0
          ? {
              ...est,
              evidence: [
                ...est.evidence,
                ...factors.factors,
                ...news.map(item => item.content),
                ...socialSignals.map(
                  tweet =>
                    `Recent social signal @${tweet.author_username}: ${tweet.text}`
                ),
              ],
              socialSignals,
            }
          : est
    );

    return {
      marketId: market.marketId,
      outcome: ensemble.primaryOutcome,
      estimatedProbability,
      confidence,
      estimates: enrichedEstimates,
      modelDisagreement: ensemble.modelDisagreement,
      evidenceSummary: [
        socialSignals.length > 0
          ? `Recent social signal: ${socialSignals.length} tweets factored into forecast`
          : "Recent social signal unavailable or empty",
      ],
      generatedAt: now,
    };
  }
}
