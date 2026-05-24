import { ENV } from "../_core/env";
import type { AgentMarket } from "./types";

const GAMMA_HOST = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CLOB_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

// ─── WebSocket Orderbook Manager ────────────────────────────────────────────

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

interface WsBookMessage {
  event_type?: string;
  asset_id?: string;
  market?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
  timestamp?: string | number;
}

export class OrderbookWebSocketManager {
  private ws: WebSocket | null = null;
  private readonly cache = new Map<string, ClobOrderBookResponse>();
  private trackedTokenIds = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly wsUrl: string;

  constructor(wsUrl = CLOB_WS_URL) {
    this.wsUrl = wsUrl;
  }

  connect(tokenIds: string[]): void {
    for (const id of tokenIds) this.trackedTokenIds.add(id);
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.open();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.subscribe(tokenIds);
    }
  }

  getBook(tokenId: string): ClobOrderBookResponse | null {
    return this.cache.get(tokenId) ?? null;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private open(): void {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.subscribe(Array.from(this.trackedTokenIds));
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const messages: WsBookMessage[] = Array.isArray(event.data)
          ? (event.data as WsBookMessage[])
          : [JSON.parse(String(event.data)) as WsBookMessage];
        for (const msg of messages) this.handleMessage(msg);
      } catch (err) {
        console.warn(
          "[OrderbookWS] Malformed frame dropped:",
          String(err).slice(0, 200)
        );
      }
    };

    this.ws.onerror = () => {
      /* logged via onclose */
    };
    this.ws.onclose = () => {
      if (!this.closed) this.scheduleReconnect();
    };
  }

  private subscribe(tokenIds: string[]): void {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      tokenIds.length === 0
    )
      return;
    this.ws.send(
      JSON.stringify({
        type: "subscribe",
        channel: "book",
        market_token_ids: tokenIds,
      })
    );
  }

  private handleMessage(msg: WsBookMessage): void {
    const tokenId = msg.asset_id ?? msg.market;
    if (!tokenId) return;
    const existing = this.cache.get(tokenId) ?? {};
    this.cache.set(tokenId, {
      ...existing,
      asset_id: tokenId,
      bids: msg.bids ?? existing.bids,
      asks: msg.asks ?? existing.asks,
      timestamp: msg.timestamp ?? existing.timestamp ?? Date.now(),
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}

export const orderbookWsManager = new OrderbookWebSocketManager(
  ENV.polymarketWsUrl || CLOB_WS_URL
);

export interface HttpClient {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface GammaMarketResponse {
  id?: string | number;
  conditionId?: string;
  question?: string;
  description?: string;
  category?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  enableOrderBook?: boolean;
  clobTokenIds?: string[] | string;
  outcomes?: string[] | string;
  volume24hr?: string | number;
  volume24h?: string | number;
  volume?: string | number;
  liquidity?: string | number;
  endDate?: string;
  endDateIso?: string;
  resolutionSource?: string;
}

export interface ClobBookLevel {
  price: string;
  size: string;
}

export interface ClobOrderBookResponse {
  market?: string;
  asset_id?: string;
  timestamp?: string | number;
  bids?: ClobBookLevel[];
  asks?: ClobBookLevel[];
  min_order_size?: string;
  tick_size?: string;
  neg_risk?: boolean;
  last_trade_price?: string;
}

export interface MarketScanOptions {
  limit: number;
  offset?: number;
  gammaHost?: string;
  clobHost?: string;
  minVolume24h?: number;
  minLiquidity?: number;
  httpClient?: HttpClient;
}

export function parseJsonArray(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(",")
      .map(part => part.trim())
      .filter(Boolean);
  }
}

export function toNumber(
  value: string | number | undefined,
  fallback = 0
): number {
  if (value === undefined || value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseTimestamp(
  value: string | number | undefined,
  fallback: Date
): Date {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "number" || /^\d+$/.test(value)) {
    const numeric = Number(value);
    const millis = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? fallback : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export function getBestBid(book: ClobOrderBookResponse): number {
  const prices = (book.bids ?? [])
    .map(level => toNumber(level.price, Number.NaN))
    .filter(Number.isFinite);
  return prices.length > 0 ? Math.max(...prices) : Number.NaN;
}

export function getBestAsk(book: ClobOrderBookResponse): number {
  const prices = (book.asks ?? [])
    .map(level => toNumber(level.price, Number.NaN))
    .filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : Number.NaN;
}

export function computeVisibleLiquidityUsd(
  book: ClobOrderBookResponse,
  levels = 5
): number {
  const sideValue = (side: ClobBookLevel[] | undefined) =>
    (side ?? [])
      .slice(0, levels)
      .reduce(
        (sum, level) => sum + toNumber(level.price) * toNumber(level.size),
        0
      );

  return sideValue(book.bids) + sideValue(book.asks);
}

export function normalizeGammaMarket(
  gamma: GammaMarketResponse
): GammaMarketResponse | null {
  if (
    gamma.active === false ||
    gamma.closed === true ||
    gamma.archived === true
  )
    return null;
  if (gamma.enableOrderBook === false) return null;
  if (!gamma.question) return null;

  const tokenIds = parseJsonArray(gamma.clobTokenIds);
  if (tokenIds.length < 2) return null;

  return gamma;
}

export function normalizeAgentMarket(
  gamma: GammaMarketResponse,
  yesBook: ClobOrderBookResponse,
  fetchedAt = new Date()
): AgentMarket | null {
  const normalized = normalizeGammaMarket(gamma);
  if (!normalized) return null;

  const tokenIds = parseJsonArray(normalized.clobTokenIds);
  const bestBid = getBestBid(yesBook);
  const bestAsk = getBestAsk(yesBook);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;

  const expiresAt = parseTimestamp(
    normalized.endDateIso ?? normalized.endDate,
    new Date(0)
  );
  const orderbookUpdatedAt = parseTimestamp(yesBook.timestamp, fetchedAt);
  const spread = bestAsk - bestBid;
  const visibleLiquidity = computeVisibleLiquidityUsd(yesBook);
  const gammaLiquidity = toNumber(normalized.liquidity);

  // Top-of-book depth: value of best bid/ask level only (signal 4).
  const topBid = (yesBook.bids ?? [])[0];
  const topAsk = (yesBook.asks ?? [])[0];
  const topOfBookDepthBid = topBid
    ? toNumber(topBid.price) * toNumber(topBid.size)
    : 0;
  const topOfBookDepthAsk = topAsk
    ? toNumber(topAsk.price) * toNumber(topAsk.size)
    : 0;

  return {
    exchange: "polymarket",
    marketId: String(normalized.id ?? yesBook.market ?? ""),
    conditionId: normalized.conditionId,
    question: normalized.question ?? "",
    resolutionCriteria: normalized.resolutionSource ?? normalized.description,
    category: normalized.category,
    yesTokenId: tokenIds[0],
    noTokenId: tokenIds[1],
    bestBid,
    bestAsk,
    spread,
    midpoint: (bestBid + bestAsk) / 2,
    volume24h: toNumber(
      normalized.volume24hr,
      toNumber(normalized.volume24h, toNumber(normalized.volume))
    ),
    liquidity: Math.max(gammaLiquidity, visibleLiquidity),
    topOfBookDepthBid,
    topOfBookDepthAsk,
    expiresAt,
    orderbookUpdatedAt,
    negRisk: yesBook.neg_risk,
  };
}

export async function fetchGammaMarkets(
  options: MarketScanOptions
): Promise<GammaMarketResponse[]> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(options.limit),
    offset: String(options.offset ?? 0),
  });
  const host = options.gammaHost ?? GAMMA_HOST;
  const http = options.httpClient ?? { fetch };
  const response = await http.fetch(`${host}/markets?${params}`);

  if (!response.ok) {
    throw new Error(
      `Gamma markets request failed (${response.status} ${response.statusText})`
    );
  }

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) {
    throw new Error("Gamma markets response was not an array");
  }

  return body as GammaMarketResponse[];
}

export async function fetchClobOrderBook(
  tokenId: string,
  options: Pick<MarketScanOptions, "clobHost" | "httpClient"> = {}
): Promise<ClobOrderBookResponse> {
  const params = new URLSearchParams({ token_id: tokenId });
  const host = options.clobHost ?? CLOB_HOST;
  const http = options.httpClient ?? { fetch };
  const response = await http.fetch(`${host}/book?${params}`);

  if (!response.ok) {
    throw new Error(
      `CLOB book request failed (${response.status} ${response.statusText})`
    );
  }

  return (await response.json()) as ClobOrderBookResponse;
}

/**
 * Resolve yes/no token IDs for a Polymarket market by its numeric ID.
 * Returns null if the market cannot be found or has no CLOB token IDs.
 * Used to hydrate arbs.xyz opportunities before live execution.
 */
export async function resolvePolymarketTokenIds(
  marketId: string,
  options: Pick<MarketScanOptions, "gammaHost" | "httpClient"> = {}
): Promise<{ yesTokenId: string; noTokenId: string } | null> {
  const host = options.gammaHost ?? GAMMA_HOST;
  const http = options.httpClient ?? { fetch };
  const response = await http.fetch(
    `${host}/markets/${encodeURIComponent(marketId)}`
  );
  if (!response.ok) return null;
  const body = (await response.json()) as GammaMarketResponse;
  const tokenIds = parseJsonArray(body.clobTokenIds);
  if (tokenIds.length < 2) return null;
  return { yesTokenId: tokenIds[0], noTokenId: tokenIds[1] };
}

export async function scanPolymarketCandidates(
  options: MarketScanOptions
): Promise<AgentMarket[]> {
  const fetchedAt = new Date();
  const gammaMarkets = await fetchGammaMarkets(options);
  const normalizedGamma = gammaMarkets
    .map(normalizeGammaMarket)
    .filter((market): market is GammaMarketResponse => Boolean(market))
    .filter(
      market =>
        toNumber(
          market.volume24hr,
          toNumber(market.volume24h, toNumber(market.volume))
        ) >= (options.minVolume24h ?? 0)
    )
    .filter(
      market => toNumber(market.liquidity) >= (options.minLiquidity ?? 0)
    );

  const candidates: AgentMarket[] = [];
  const allTokenIds = normalizedGamma.flatMap(m =>
    parseJsonArray(m.clobTokenIds)
  );
  orderbookWsManager.connect(allTokenIds);

  for (const market of normalizedGamma) {
    const [yesTokenId] = parseJsonArray(market.clobTokenIds);
    if (!yesTokenId) continue;

    const cachedBook = orderbookWsManager.getBook(yesTokenId);
    const book = cachedBook ?? (await fetchClobOrderBook(yesTokenId, options));
    const agentMarket = normalizeAgentMarket(market, book, fetchedAt);
    if (agentMarket) candidates.push(agentMarket);
  }

  return candidates;
}
