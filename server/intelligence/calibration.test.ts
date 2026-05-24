import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getBayesianPrior: vi.fn(async () => ({
    category: "politics",
    priorProbability: "0.62",
    sampleSize: 40,
  })),
  getBotConfig: vi.fn(async () => ({
    minConfidence: "0.75",
  })),
}));

import {
  buildCategoryCalibrationContext,
  calibrateConfidence,
  calibrateProbability,
  describeCalibrationContext,
} from "./calibration";

describe("calibration", () => {
  it("blends category priors into the calibration context", async () => {
    const context = await buildCategoryCalibrationContext("politics");
    expect(context.priorProbability).toBeCloseTo(0.62);
    expect(context.blendWeight).toBe(0.35);
    expect(context.confidenceFloor).toBe(0.75);
    expect(describeCalibrationContext(context)).toContain("category prior");
  });

  it("calibrates probability and confidence conservatively", () => {
    const context = {
      category: "politics",
      priorProbability: 0.62,
      priorSampleSize: 40,
      confidenceFloor: 0.75,
      blendWeight: 0.35,
    };

    expect(calibrateProbability(0.8, context)).toBeCloseTo(0.737, 3);
    expect(calibrateConfidence(0.8, context)).toBeGreaterThanOrEqual(0.75);
  });
});
