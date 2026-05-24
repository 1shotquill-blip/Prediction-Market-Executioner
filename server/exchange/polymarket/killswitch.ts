import { ENV } from "../../_core/env";
import { getClobSpreadBps } from "../../agent/book-pricing";
import type { AgentMarket } from "../../agent/types";
import { KillswitchBlocked } from "./errors";

export interface PolymarketKillswitchLimits {
  armed: boolean;
  maxNotionalUsd: number;
  maxOrdersPerMinute: number;
  perMarketCapUsd: number;
  maxSpreadBps: number;
}

export type CancelAllFn = () => Promise<void>;

export class PolymarketKillswitch {
  private readonly orderTimestamps: number[] = [];
  private disarmed = false;

  constructor(
    private readonly limits: PolymarketKillswitchLimits = {
      armed: ENV.polymarketKillswitchArmed,
      maxNotionalUsd: ENV.polymarketMaxNotionalUsd,
      maxOrdersPerMinute: ENV.polymarketMaxOrdersPerMinute,
      perMarketCapUsd: ENV.polymarketPerMarketCapUsd,
      maxSpreadBps: ENV.polymarketMaxSpreadBps,
    }
  ) {}

  // Gap 9 fix: disarm blocks all future orders AND cancels open GTC orders.
  async disarm(cancelAll?: CancelAllFn): Promise<void> {
    this.disarmed = true;
    console.error("[Killswitch] DISARMED — blocking all new orders");
    if (cancelAll) {
      try {
        await cancelAll();
        console.log("[Killswitch] Open GTC orders cancelled");
      } catch (err) {
        console.error("[Killswitch] Failed to cancel open orders:", err);
      }
    }
  }

  isArmed(): boolean {
    return this.limits.armed && !this.disarmed;
  }

  assertCanSubmit(notionalUsd: number, now = new Date()): void {
    if (!this.limits.armed || this.disarmed) {
      throw new KillswitchBlocked(
        "POLYMARKET_KILLSWITCH_ARMED must be true before live order submission"
      );
    }
    if (notionalUsd <= 0) {
      throw new KillswitchBlocked("Order notional must be positive");
    }
    if (notionalUsd > this.limits.maxNotionalUsd) {
      throw new KillswitchBlocked(
        `Order notional ${notionalUsd.toFixed(2)} exceeds cap ${this.limits.maxNotionalUsd.toFixed(2)}`
      );
    }

    const cutoff = now.getTime() - 60_000;
    while (
      this.orderTimestamps.length > 0 &&
      this.orderTimestamps[0] < cutoff
    ) {
      this.orderTimestamps.shift();
    }
    if (this.orderTimestamps.length >= this.limits.maxOrdersPerMinute) {
      throw new KillswitchBlocked(
        `Order rate exceeds ${this.limits.maxOrdersPerMinute}/minute cap`
      );
    }
    this.orderTimestamps.push(now.getTime());
  }

  assertMarketCanSubmit(
    notionalUsd: number,
    market: AgentMarket,
    now = new Date()
  ): void {
    this.assertCanSubmit(notionalUsd, now);
    if (notionalUsd > this.limits.perMarketCapUsd) {
      throw new KillswitchBlocked(
        `Order notional ${notionalUsd.toFixed(2)} exceeds per-market cap ${this.limits.perMarketCapUsd.toFixed(2)}`
      );
    }

    const spreadBps = getClobSpreadBps(market);
    if (!Number.isFinite(spreadBps)) {
      throw new KillswitchBlocked("Market book is invalid");
    }
    if (spreadBps > this.limits.maxSpreadBps) {
      throw new KillswitchBlocked(
        `Market spread ${spreadBps.toFixed(0)} bps exceeds cap ${this.limits.maxSpreadBps}`
      );
    }
  }
}
