# Production Polymarket Agent

This directory is the production agent layer. The old `server/bot-engine.ts`
remains a prototype loop; production code should move through these contracts
before any live-money execution is connected.

## Design Rules

1. Trading decisions are typed and auditable.
2. Public market data and private execution stay behind separate adapters.
3. The risk manager can only reduce or block size.
4. Reconciliation must be clean before execution is allowed.
5. Live orders must not be marked filled or cancelled until exchange state confirms it.

## Build Order

1. Market scanner: Gamma discovery plus CLOB orderbook normalization. Done.
2. Portfolio reconciliation: balances, positions, open orders, local DB state. Core logic done; live adapters pending.
3. Risk manager: edge, confidence, spread, drawdown, exposure, and stale-data gates. Done.
4. Paper execution: bid/ask-aware simulation with order lifecycle events. Done.
5. Decision audit persistence: every skip/order is queryable for tuning. Done.
6. Live CLOB execution: signed GTC limit orders, confirmed cancellation, fill sync.
7. Intelligence ensemble: base-rate, research, sentiment, microstructure, calibration.
8. Backtest and paper-trading reports before live scale-up.

## Performance Target

The agent tracks win rate, realized P&L, average win/loss, profit factor, and
Brier score. High win rate is desirable, but the deployment gate is not win rate
alone. A 90% win rate can still lose money if losses are oversized, so scaling
requires both strong hit rate and positive expected value after bid/ask costs.

## Current Execution Boundary

`PaperExecutionAdapter` is the only implemented execution adapter. It simulates
exchange acceptance and bid/ask-aware fills, then persists lifecycle updates
through `order-persistence.ts`. Live execution remains intentionally blocked
until the CLOB adapter can provide signed order placement, confirmed
cancellation, and fill synchronization.

## Decision Audit Dataset

Every orchestrator tick can persist one `decision_audits` row per scanned
market. This table is the core training and tuning dataset:

- why a market was skipped
- probability, confidence, edge, bid, ask, spread
- order ids and lifecycle status when traded
- risk diagnostics and execution receipts

Future win-rate and calibration improvements should be driven from this table,
not from anecdotal trade review.
