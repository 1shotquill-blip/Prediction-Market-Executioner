import { getBayesianPrior, getBotConfig } from "../db";

export interface CategoryCalibrationContext {
  category?: string;
  priorProbability?: number;
  priorSampleSize: number;
  confidenceFloor: number;
  blendWeight: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function buildCategoryCalibrationContext(
  category?: string
): Promise<CategoryCalibrationContext> {
  const [prior, botConfig] = await Promise.all([
    category ? getBayesianPrior(category) : Promise.resolve(undefined),
    getBotConfig(),
  ]);

  const priorProbability = prior ? toNumber(prior.priorProbability) : undefined;
  const priorSampleSize = prior?.sampleSize ?? 0;
  const confidenceFloor = botConfig ? toNumber(botConfig.minConfidence) : 0.6;
  const blendWeight =
    priorProbability == null
      ? 0
      : clamp(priorSampleSize / (priorSampleSize + 20), 0.05, 0.35);

  return {
    category,
    priorProbability,
    priorSampleSize,
    confidenceFloor,
    blendWeight,
  };
}

export function calibrateProbability(
  probability: number,
  context: CategoryCalibrationContext
): number {
  if (context.priorProbability == null) return clamp(probability, 0.01, 0.99);
  const blended =
    probability * (1 - context.blendWeight) +
    context.priorProbability * context.blendWeight;
  return clamp(blended, 0.01, 0.99);
}

export function calibrateConfidence(
  confidence: number,
  context: CategoryCalibrationContext
): number {
  const softened = confidence * (1 - context.blendWeight * 0.25);
  return clamp(
    Math.max(context.confidenceFloor, softened),
    context.confidenceFloor,
    1
  );
}

export function describeCalibrationContext(
  context: CategoryCalibrationContext
): string {
  const prior =
    context.priorProbability == null
      ? "n/a"
      : context.priorProbability.toFixed(3);
  return [
    `category prior probability: ${prior}`,
    `prior sample size: ${context.priorSampleSize}`,
    `confidence floor: ${context.confidenceFloor.toFixed(2)}`,
    `prior blend weight: ${context.blendWeight.toFixed(2)}`,
  ].join(", ");
}
