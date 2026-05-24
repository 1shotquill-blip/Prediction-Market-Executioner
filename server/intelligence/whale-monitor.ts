/**
 * Whale wallet monitor.
 *
 * Polls the Polymarket Data API for the top-100 P&L wallets every 60 seconds,
 * detects new positions larger than $2k, and exposes those prints as
 * TradePrint[] for the anomaly scanner's whale component.
 *
 * The singleton WhaleMonitor runs in the background; callers call
 * getWhaleTradesForMarket(marketId) to retrieve recent prints.
 */

import type { TradePrint } from "./anomaly-scanner";

const POLYMARKET_DATA_API =
  process.env.POLYMARKET_DATA_API_URL ?? "https://data-api.polymarket.com";

const WHALE_MIN_POSITION_USD = 2_000;
const POLL_INTERVAL_MS = 60_000;
const RETENTION_MS = 4 * 60 * 60 * 1_000; // keep 4 hours of prints

// ─── Raw API shapes ───────────────────────────────────────────────────────────

interface LeaderboardEntry {
  proxy_wallet_address?: string;
  address?: string;
  pnl?: number;
  volume?: number;
  realizedPnl?: number;
}

interface UserPosition {
  market?: string;
  conditionId?: string;
  marketId?: string;
  outcome?: string;
  size?: number;
  avgPrice?: number;
  currentValue?: number;
  initialValue?: number;
  cashPnl?: number;
}

interface UserPositionsResponse {
  positions?: UserPosition[];
  data?: UserPosition[];
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface WhaleWallet {
  address: string;
  historicalWinRate: number; // 0–1, estimated from realizedPnl
}

interface StoredPrint {
  marketId: string;
  print: TradePrint;
}

let wallets: WhaleWallet[] = [];
let prints: StoredPrint[] = [];
let lastLeaderboardFetch = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateWinRate(entry: LeaderboardEntry): number {
  const pnl = Number(entry.pnl ?? entry.realizedPnl ?? 0);
  const volume = Number(entry.volume ?? 1);
  // crude proxy: positive pnl / volume, capped 0-1
  if (volume <= 0) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + pnl / (volume * 2)));
}

async function fetchTopWallets(): Promise<WhaleWallet[]> {
  const url = `${POLYMARKET_DATA_API}/leaderboard?limit=100&sort=pnl&order=desc`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const body = (await res.json()) as
    | LeaderboardEntry[]
    | { data?: LeaderboardEntry[] };
  const entries: LeaderboardEntry[] = Array.isArray(body)
    ? body
    : (body.data ?? []);
  return entries
    .map(e => ({
      address: String(e.proxy_wallet_address ?? e.address ?? ""),
      historicalWinRate: estimateWinRate(e),
    }))
    .filter(w => w.address.length > 0);
}

async function fetchWalletPositions(address: string): Promise<UserPosition[]> {
  const url = `${POLYMARKET_DATA_API}/positions?user=${encodeURIComponent(address)}&limit=50`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as UserPositionsResponse | UserPosition[];
  if (Array.isArray(body)) return body;
  return body.positions ?? body.data ?? [];
}

function positionToTradePrint(
  pos: UserPosition,
  winRate: number
): { marketId: string; print: TradePrint } | null {
  const marketId = String(pos.conditionId ?? pos.marketId ?? pos.market ?? "");
  if (!marketId) return null;

  const currentValue = Number(pos.currentValue ?? 0);
  const initialValue = Number(pos.initialValue ?? pos.size ?? 0);
  const sizeUsd = Math.max(currentValue, initialValue);
  if (sizeUsd < WHALE_MIN_POSITION_USD) return null;

  const avgPrice = Number(pos.avgPrice ?? 0.5);
  const side: "buy" | "sell" =
    (pos.cashPnl ?? 0) >= 0 || pos.outcome === "YES" ? "buy" : "sell";

  return {
    marketId,
    print: {
      price: avgPrice,
      // weight size by whale's historical win rate so a 60% win-rate whale
      // counts more than a coin-flip wallet
      sizeUsd: sizeUsd * (0.5 + winRate * 0.5),
      side,
      observedAt: new Date(),
    },
  };
}

function pruneStale(): void {
  const cutoff = Date.now() - RETENTION_MS;
  prints = prints.filter(p => p.print.observedAt.getTime() > cutoff);
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    // Refresh leaderboard every 10 minutes (wallets don't change fast)
    if (Date.now() - lastLeaderboardFetch > 10 * 60_000) {
      wallets = await fetchTopWallets();
      lastLeaderboardFetch = Date.now();
      console.log(
        `[WhaleMonitor] leaderboard refreshed: ${wallets.length} wallets`
      );
    }

    // Sample up to 20 wallets per tick to stay within rate limits
    const sample = wallets.slice(0, 20);
    const results = await Promise.allSettled(
      sample.map(w => fetchWalletPositions(w.address))
    );

    let newPrints = 0;
    for (let i = 0; i < sample.length; i++) {
      const result = results[i];
      if (result.status !== "fulfilled") continue;
      const wallet = sample[i];
      for (const pos of result.value) {
        const entry = positionToTradePrint(pos, wallet.historicalWinRate);
        if (entry) {
          prints.push(entry);
          newPrints++;
        }
      }
    }

    pruneStale();
    if (newPrints > 0) {
      console.log(
        `[WhaleMonitor] detected ${newPrints} whale position(s) ≥$${WHALE_MIN_POSITION_USD}; total_retained=${prints.length}`
      );
    }
  } catch (err) {
    console.warn("[WhaleMonitor] poll error:", err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns recent whale TradePrints for a given marketId, suitable for
 * passing into AnomalyScannerContext.whaleTrades.
 */
export function getWhaleTradesForMarket(marketId: string): TradePrint[] {
  pruneStale();
  return prints.filter(p => p.marketId === marketId).map(p => p.print);
}

/**
 * Start the background polling loop. Safe to call multiple times — only
 * starts one timer. Call from bot startup.
 */
export function startWhaleMonitor(): void {
  if (pollTimer !== null) return;
  void poll(); // immediate first fetch
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  console.log("[WhaleMonitor] started (interval=60s, min_position=$2k)");
}

/**
 * Stop the polling loop (useful for tests / graceful shutdown).
 */
export function stopWhaleMonitor(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
