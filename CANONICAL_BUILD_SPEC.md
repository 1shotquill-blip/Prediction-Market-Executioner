# Canonical Build Spec

## Repo Truth

- Absolute path: `/Users/jessewinters/Desktop/POLY-SHORE-main`
- Branch: `main`
- Commit: `4ef4298fe2a0cf4e33bf50db8f7683bb09beafd5`
- Package manager: `pnpm`
- Stack: TypeScript, Node.js, Express, tRPC, React, Vite, Drizzle ORM, MySQL
- Backend framework: Express with tRPC at `/api/trpc`
- Frontend framework: React 19 with Vite
- Database layer: Drizzle ORM schema and migrations targeting MySQL

## Product Direction

This repository is a Polymarket autonomous trading agent. The production path is the typed `server/agent` implementation, not the older prototype loop in `server/bot-engine.ts`. The system must trade only after verified market data, probability evaluation, hard risk approval, execution lifecycle persistence, and clean reconciliation.

Live trading is implemented behind a fail-closed Polymarket CLOB v2 adapter. It requires a private key, viem signer setup, L2 API credentials, encrypted credential cache key, allowance checks, and an armed kill switch before any live order can be submitted. Paper trading remains the default execution mode.

## Required Operational System

1. Discover active Polymarket markets through Gamma and normalize executable CLOB orderbook data.
2. Reject stale, illiquid, wide-spread, malformed, or unresolved markets before intelligence evaluation.
3. Produce calibrated probability decisions with evidence and confidence; malformed intelligence output must skip trading.
4. Enforce risk limits for edge, confidence, spread, stale data, model disagreement, drawdown, daily loss, exposure, open orders, order size, and liquidity participation.
5. Rank executable opportunities when order capacity is limited and persist the ranking score in decision audits.
6. Enforce the deep-edge anomaly gate before execution: anomaly score must be at least `DEEP_EDGE_MIN_SCORE`, deep-reasoner confidence must be at least `DEEP_EDGE_MIN_CONFIDENCE`, and expected correction must be at least 10%.
7. Persist contrarian justification, steelman rebuttal, identified blind spot, catalyst forecast, memory matches, and anomaly diagnostics in decision audits.
8. Submit paper orders through bid/ask-aware execution, then persist local intent and lifecycle updates.
9. Submit live GTC limit orders through `@polymarket/clob-client-v2`, derive/cache L2 credentials via `/auth/api-key` or `/auth/derive-api-key` through the SDK, enforce allowances, track exchange order IDs, confirm cancellations, and synchronize fills from exchange state.
10. Block all execution unless portfolio reconciliation status is `ok`.
11. Expose operational agent APIs for market scanning and decision audit review through tRPC.
12. Keep legacy prototype code from falsely reporting production readiness.
13. Prove install state, lint, typecheck, tests, build, runtime smoke, and proof-artifact checks before claiming readiness.

## Current Runtime Commands

- Install: `pnpm install`
- Typecheck: `pnpm check`
- Test: `pnpm test`
- Build: `pnpm build`
- Development runtime: `pnpm dev`
- Production runtime: `pnpm build && pnpm start`
- Database migration command: `pnpm db:push`
- Lint/static gate: `pnpm lint`

## Deep Edge Environment Variables

- `DEEP_EDGE_MIN_SCORE`: minimum anomaly score, default `0.7`.
- `DEEP_EDGE_MIN_CONFIDENCE`: minimum deep reasoner confidence, default `0.8`.
- `MAX_BASKET_LEGS`: maximum legs in a synthetic arbitrage basket, default `10`.
- `CATALYST_TIMEOUT_MULTIPLIER`: catalyst timeout buffer before re-evaluation, default `1.5`.
- `OLLAMA_HOST`: Ollama host for deep reasoning, default `http://localhost:11434`.
- `OLLAMA_MODEL`: Ollama model for deep reasoning, default `llama3.1:8b`.

## Polymarket Live Execution Environment Variables

- `POLYMARKET_PRIVATE_KEY`: required for live CLOB signing.
- `POLYMARKET_HOST`: CLOB host, default `https://clob.polymarket.com`; `POLYMARKET_CLOB_HOST` remains accepted as an alias.
- `POLYMARKET_CHAIN_ID`: chain ID, default `137`.
- `POLYMARKET_FUNDER_ADDRESS`: funder address, signer address for signature type `0`.
- `POLYMARKET_SIGNATURE_TYPE`: CLOB signature type, default `0`.
- `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`: optional pre-derived L2 credentials; if absent the adapter derives through SDK auth endpoints and cache.
- `POLYGON_RPC_URL`: Polygon RPC transport used by the viem signer.
- `POLYMARKET_CREDENTIAL_CACHE_PATH`: encrypted L2 credential cache path, default `.polymarket-l2-credentials.enc`.
- `POLYMARKET_CREDENTIAL_CACHE_KEY`: required to encrypt cached L2 credentials.
- `KILLSWITCH_ARMED`: must be `true` before live order submission; `POLYMARKET_KILLSWITCH_ARMED` remains accepted as an alias.
- `KILLSWITCH_NOTIONAL_CAP_USD`: per-order live notional cap, default `100`.
- `KILLSWITCH_ORDERS_PER_MIN`: live order rate cap, default `6`.
- `KILLSWITCH_PER_MARKET_CAP_USD`: per-market live notional cap, default `100`.
- `KILLSWITCH_MAX_SPREAD_BPS`: maximum executable spread, default `500`.
- `POLYMARKET_DEFAULT_TICK_SIZE`: default order tick size passed to CLOB v2, default `0.01`.
- `POLYMARKET_WS_URL`: optional user-channel websocket URL; REST reconciliation remains available.

Live-mode readiness requires `LIVE_TRADING_ENABLED=true`, wallet/funder/RPC configuration, direct L2 credentials or an encrypted credential cache key, and `KILLSWITCH_ARMED=true`. Until then, attempts to switch the bot to live mode return a missing-field map instead of enabling real execution.

## Existing APIs

- HTTP: `/api/trpc`
- OAuth callback: `/api/oauth/callback`
- Storage proxy: `/manus-storage/*`
- tRPC routers: `auth`, `system`, `bot`, `agent`
- Agent procedures: `agent.scanCandidates`, `agent.recentDecisionAudits`
- Bot prototype procedures: `bot.status`, `bot.start`, `bot.stop`, `bot.pause`, `bot.resume`, `bot.setExecutionMode`, `bot.recentTrades`, `bot.equityHistory`, `bot.openOrders`, `bot.updateConfig`

## Known Non-Production Areas

- `README_BOT.md` and `todo.md` claim completion that is not supported by the codebase.
- Live execution is available only through the fail-closed Polymarket adapter and is not armed by default.
- The component showcase contains demo UI content unrelated to the production agent.
