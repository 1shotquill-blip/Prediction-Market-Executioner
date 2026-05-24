import { describe, expect, it } from "vitest";
import {
  bregmanProjectToSimplex,
  buildMutuallyExclusiveYesBasket,
  validateZeroRiskPositiveExpectedValue,
} from "./basket-builder";

describe("basket builder", () => {
  it("projects probabilities onto the simplex", () => {
    const projected = bregmanProjectToSimplex([0.2, 0.3, 0.8]);
    expect(projected.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(projected.every(value => value > 0)).toBe(true);
  });

  it("constructs only proven zero-risk positive expected value baskets", () => {
    const basket = buildMutuallyExclusiveYesBasket(
      [
        {
          marketId: "a",
          bestBid: 0.2,
          bestAsk: 0.4,
          probability: 0.5,
          exclusiveGroup: "winner",
        },
        {
          marketId: "b",
          bestBid: 0.2,
          bestAsk: 0.4,
          probability: 0.5,
          exclusiveGroup: "winner",
        },
      ],
      0.4
    );

    expect(basket).not.toBeNull();
    expect(validateZeroRiskPositiveExpectedValue(basket!)).toBe(true);
  });
});
