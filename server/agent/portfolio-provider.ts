import { getExchangePortfolioState } from "./portfolio-state";
import type { PortfolioSnapshot } from "./types";
import type { PortfolioProvider } from "./orchestrator";

export class ClobPortfolioProvider implements PortfolioProvider {
  async snapshot(now = new Date()): Promise<PortfolioSnapshot> {
    const state = await getExchangePortfolioState(now);
    return state.snapshot;
  }
}
