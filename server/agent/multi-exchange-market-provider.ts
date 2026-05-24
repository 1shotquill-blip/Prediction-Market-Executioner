import type { AgentMarket } from "./types";
import type { MarketProvider } from "./orchestrator";
import { scanPolymarketCandidates } from "./polymarket-client";
import { listKalshiMarkets } from "../exchange/kalshi";

export interface MultiExchangeMarketProviderOptions {
  limit?: number;
  minVolume24h?: number;
  minLiquidity?: number;
}

export class MultiExchangeMarketProvider implements MarketProvider {
  private kalshiWarnedOnce = false;

  constructor(
    private readonly options: MultiExchangeMarketProviderOptions = {}
  ) {}

  async scan(): Promise<AgentMarket[]> {
    const limit = this.options.limit ?? 50;
    const [kalshi, polymarket] = await Promise.all([
      listKalshiMarkets(undefined, { limit }).catch(error => {
        if (!this.kalshiWarnedOnce) {
          console.warn(
            "[MultiExchange] Kalshi unavailable (will not repeat):",
            String(error).slice(0, 120)
          );
          this.kalshiWarnedOnce = true;
        }
        return [];
      }),
      scanPolymarketCandidates({
        limit,
        minVolume24h: this.options.minVolume24h ?? 0,
        minLiquidity: this.options.minLiquidity ?? 0,
      }),
    ]);
    console.log(
      `[MultiExchange] Polymarket markets scanned=${polymarket.length}; Kalshi markets scanned=${kalshi.length}`
    );
    return [
      ...kalshi.map(market => ({ ...market, exchange: "kalshi" as const })),
      ...polymarket.map(market => ({
        ...market,
        exchange: "polymarket" as const,
      })),
    ];
  }
}
