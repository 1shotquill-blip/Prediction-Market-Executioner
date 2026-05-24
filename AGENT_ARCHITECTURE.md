# Polymarket Agent Architecture

This project is being rebuilt as a production-grade autonomous Polymarket agent.
The goal is not to maximize trade count. The goal is to only trade when the
agent has verified market data, calibrated probability estimates, clean exchange
reconciliation, and risk approval.

## Non-Negotiable Live Trading Gates

The agent may not enter live mode unless all of these are true:

- CLOB order placement uses signed GTC limit orders through a production adapter.
- CLOB cancellation waits for exchange confirmation before local state changes.
- Fill tracking handles accepted, rejected, partial fill, filled, cancelled, and expired states.
- Portfolio reconciliation compares local DB state against exchange balances, positions, and open orders.
- Reconciliation status is `ok` before any new order can be submitted.
- Market data uses CLOB executable bid/ask prices, not midpoint-only Gamma prices.
- Stale orderbooks, wide spreads, thin liquidity, and ambiguous resolution rules block trades.
- Risk manager enforces exposure, drawdown, daily loss, open order, and liquidity participation caps.
- Paper trading simulates bid/ask execution and order lifecycle behavior.
- Tests, typecheck, security review, and at least 72 hours of paper logs are clean.

## Runtime Pipeline

```text
Market Scanner
  -> Market Normalizer
  -> Research Agent
  -> Probability Ensemble
  -> Edge Calculator
  -> Risk Manager
  -> Execution Manager
  -> Reconciliation Loop
  -> Monitoring and Audit Log
```

## Core Modules

### Market Scanner

Discovers markets from Gamma, then upgrades each candidate with CLOB orderbook
data. The scanner should emit only active markets with fresh bid/ask prices,
token ids, depth, spread, volume, liquidity, and expiry.

### Research Agent

Creates a market dossier:

- resolution criteria
- key drivers
- current facts
- source URLs
- contradiction notes
- base rate
- probability estimate
- confidence

The research agent never directly places trades.

### Probability Ensemble

Combines independent estimates:

- base-rate model
- LLM research model
- sentiment model
- market microstructure model
- historical analog model
- arbitrage or negative-risk checker

Each estimate must include probability, confidence, evidence, freshness, and
failure reason when unavailable.

### Risk Manager

The risk manager is a hard gate. It can only allow, reduce, or block a trade.
It never increases size beyond the configured caps.

Default first-live limits should be conservative:

```text
minEdge = 0.06
minConfidence = 0.70
maxSpread = 0.03
maxSingleMarketExposure = 3%
maxCategoryExposure = 8%
maxTotalExposure = 20%
maxDailyLoss = 3%
maxDrawdown = 8%
fractionalKelly = 0.25
```

### Execution Manager

The execution manager owns order lifecycle. Live execution must submit signed
CLOB orders and persist the exchange order id/hash. Local state changes must
follow exchange confirmation.

Lifecycle states:

```text
INTENT_CREATED
ORDER_SIGNED
ORDER_POSTED
ACCEPTED_BY_CLOB
PARTIALLY_FILLED
FILLED
CANCEL_REQUESTED
CANCEL_CONFIRMED
EXPIRED
REJECTED
RECONCILIATION_MISMATCH
```

### Reconciliation Loop

The reconciliation loop continuously compares:

- local pending orders
- CLOB open orders
- CLOB fills/trades
- wallet or exchange balance
- current positions
- local exposure calculations

Any mismatch pauses new execution and alerts the owner.

## Milestones

### Milestone 1: Safety Foundation

- Production types and risk manager.
- Tests for risk gates.
- Architecture and implementation order documented.

### Milestone 2: Real Market Data

- Gamma market discovery.
- CLOB orderbook normalization.
- Market freshness, spread, depth, and liquidity filters.

### Milestone 3: Reconciliation and Paper Execution

- Portfolio snapshot builder.
- Bid/ask-aware paper execution.
- Order lifecycle persistence.
- Dashboard displays skipped trade reasons.
- Decision audit table for every skip/order.

### Milestone 4: Live CLOB Adapter

- Signed GTC limit order placement.
- Confirmed cancellation.
- Fill polling or websocket ingestion.
- Live mode remains capped to small exposure.

### Milestone 5: Intelligence and Calibration

- Research dossier generator.
- Probability ensemble.
- Calibration reports and Brier score.
- Backtest and 72-hour paper validation.

### Milestone 6: Controlled Live Rollout

- Read-only live reconciliation.
- Live trades capped to test capital.
- Scale only after verified calibration and clean operations.
