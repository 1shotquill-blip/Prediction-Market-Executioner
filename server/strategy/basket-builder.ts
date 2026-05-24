import { ENV } from "../_core/env";

export interface BasketMarket {
  marketId: string;
  bestBid: number;
  bestAsk: number;
  probability: number;
  exclusiveGroup?: string;
}

export interface BasketLeg {
  marketId: string;
  side: "buy" | "sell";
  outcome: "yes";
  price: number;
  quantity: number;
}

export interface ArbitrageBasket {
  legs: BasketLeg[];
  costUsd: number;
  minimumPayoutUsd: number;
  expectedValueUsd: number;
  proof: string;
}

export function bregmanProjectToSimplex(values: number[]): number[] {
  const positive = values.map(value => Math.max(1e-9, value));
  const total = positive.reduce((sum, value) => sum + value, 0);
  return positive.map(value => value / total);
}

export function validateZeroRiskPositiveExpectedValue(
  basket: ArbitrageBasket
): boolean {
  return (
    basket.legs.length > 0 &&
    basket.minimumPayoutUsd > basket.costUsd &&
    basket.expectedValueUsd > 0
  );
}

export function buildMutuallyExclusiveYesBasket(
  markets: BasketMarket[],
  stakePerLegUsd = 1,
  maxLegs = ENV.maxBasketLegs
): ArbitrageBasket | null {
  const grouped = new Map<string, BasketMarket[]>();
  for (const market of markets) {
    if (!market.exclusiveGroup) continue;
    const current = grouped.get(market.exclusiveGroup) ?? [];
    current.push(market);
    grouped.set(market.exclusiveGroup, current);
  }

  for (const [group, groupMarkets] of Array.from(grouped.entries())) {
    const legs: BasketLeg[] = groupMarkets.slice(0, maxLegs).map(market => ({
      marketId: market.marketId,
      side: "buy",
      outcome: "yes",
      price: market.bestAsk,
      quantity: stakePerLegUsd / market.bestAsk,
    }));
    if (legs.length < 2) continue;

    const costUsd = legs.reduce(
      (sum: number, leg: BasketLeg) => sum + leg.price * leg.quantity,
      0
    );
    const minimumPayoutUsd = Math.min(
      ...legs.map((leg: BasketLeg) => leg.quantity)
    );
    const projected = bregmanProjectToSimplex(
      groupMarkets.slice(0, maxLegs).map(market => market.probability)
    );
    const expectedPayoutUsd = legs.reduce(
      (sum: number, leg: BasketLeg, index: number) =>
        sum + leg.quantity * projected[index],
      0
    );
    const basket: ArbitrageBasket = {
      legs,
      costUsd,
      minimumPayoutUsd,
      expectedValueUsd: expectedPayoutUsd - costUsd,
      proof: `Group ${group} buy-YES basket costs ${costUsd.toFixed(6)} and has worst-case payout ${minimumPayoutUsd.toFixed(6)} after Bregman probability projection.`,
    };

    if (validateZeroRiskPositiveExpectedValue(basket)) return basket;
  }

  return null;
}
