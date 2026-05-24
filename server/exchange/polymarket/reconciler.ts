import { ENV } from "../../_core/env";
import type { ExchangePortfolioState } from "../../agent/reconciliation";
import { PolymarketConfigurationError } from "./errors";
import { fetchPolymarketExchangeState } from "./positions";
import type { PolymarketClientLike } from "./types";

export interface PolymarketUserEvent {
  receivedAt: Date;
  type: string;
  payload: unknown;
}

export interface PolymarketReconcilerOptions {
  wsUrl?: string;
}

function parseUserEvent(raw: MessageEvent): PolymarketUserEvent {
  const data = raw.data;
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      return {
        receivedAt: new Date(),
        type: String(parsed.type ?? parsed.event ?? "message"),
        payload: parsed,
      };
    } catch {
      return {
        receivedAt: new Date(),
        type: "message",
        payload: data,
      };
    }
  }

  return {
    receivedAt: new Date(),
    type: "message",
    payload: data,
  };
}

export class PolymarketUserReconciler {
  private socket?: WebSocket;
  private readonly events: PolymarketUserEvent[] = [];

  constructor(
    private readonly client: PolymarketClientLike,
    private readonly options: PolymarketReconcilerOptions = {
      wsUrl: ENV.polymarketWsUrl,
    }
  ) {}

  connect(): boolean {
    if (!this.options.wsUrl) return false;
    if (typeof WebSocket === "undefined") {
      throw new PolymarketConfigurationError(
        "WebSocket is not available in this runtime"
      );
    }

    this.socket = new WebSocket(this.options.wsUrl);
    this.socket.addEventListener("message", message => {
      this.events.push(parseUserEvent(message));
    });
    return true;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  drainEvents(): PolymarketUserEvent[] {
    return this.events.splice(0, this.events.length);
  }

  poll(): Promise<ExchangePortfolioState> {
    return fetchPolymarketExchangeState(this.client);
  }
}

export function createPolymarketUserReconciler(
  client: PolymarketClientLike,
  options?: PolymarketReconcilerOptions
): PolymarketUserReconciler {
  return new PolymarketUserReconciler(client, options);
}
