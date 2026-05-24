# POLY-SHORE INSTITUTIONAL ARCHITECTURE

## Overview

POLY-SHORE is an acquisition-ready prediction market execution engine built for institutional deployments. It delivers deterministic, replay-safe order execution with no duplicate-order risk.

## Core Components

### 1. Deterministic Execution Engine
**File:** `server/_core/deterministic-execution-engine.ts`

- Unique `executionId` + `correlationId` on every order
- Stable `clientOrderId` generated BEFORE exchange submission (prevents duplicates)
- Distributed Redis lock per market/order (prevents concurrent submission)
- Immutable execution journal (append-only state transitions)
- Atomic phase transitions (INTENT_CREATED → RISK_GATED → LOCKED → SUBMITTED → ACCEPTED → FILLED)
- Restart-safe recovery (full context + history reconstruction)

**Guarantees:**
- Zero duplicate order risk
- Replay-safe lifecycle
- Authoritative state transitions
- Recovery from any crash point

### 2. WebSocket-First Orchestration
**File:** `server/_core/websocket-orchestrator.ts`

- PRIMARY: WebSocket stream handlers trigger execution
- SECONDARY: Redis/BullMQ bounded workers (max 5 concurrent orders)
- TERTIARY: Polling only for reconciliation fallback
- No recursive orchestration loops
- Event-driven execution model

**Architecture:**
- Exchange stream updates emit execution events
- Events enqueued to BullMQ with idempotent job IDs
- Workers process deterministically
- On WebSocket disconnect, polling fallback activates
- Polling stops when WebSocket reconnects

### 3. Authoritative Risk Engine
**File:** `server/_core/authoritative-risk-engine.ts`

- Synchronous pre-trade gate (no bypass paths)
- 12 hard/soft gates:
  - **HARD:** Portfolio reconciliation, market data quality, confidence, edge, drawdown, daily loss, reserve floor
  - **SOFT:** Liquidity, exposure caps, concentration, correlation, slippage
- Portfolio health scoring (0-100)
- Correlation-aware risk computation
- Reserve protection enforcement
- Black-swan slippage estimation

**Decision Flow:**
1. Portfolio reconciliation check → REJECT if dirty
2. Market data validation → REJECT if stale/corrupt
3. Confidence + Edge gates → REJECT if insufficient
4. Drawdown kill switch → REJECT if triggered
5. Daily loss stop → REJECT if hit
6. Reserve floor → REJECT if violated
7. Exposure caps, concentration, correlation (warnings)
8. Kelly sizing + liquidity caps
9. Risk gate decision (APPROVED/CONDITIONAL/REJECTED)

### 4. Institutional Observability
**File:** `server/_core/observability-stack.ts`

- Structured JSON logging with secret redaction
- OpenTelemetry trace instrumentation
- Prometheus metrics (execution latency, fill rate, drawdown, health score)
- Correlation ID propagation
- Sentry error tracking

**Key Metrics:**
- `execution_latency_ms` — submission to acceptance time
- `fill_rate_pct` — execution success rate
- `portfolio_drawdown_pct` — current drawdown
- `portfolio_health_score` — 0-100 health score
- `risk_gate_rejections_total` — risk gate blocks by reason
- `execution_phase_transitions_total` — state transitions

### 5. Append-Only Execution Journal
**File:** `server/_core/append-only-journal.ts`

- SQLite immutable journal (no updates/deletes)
- Every state transition logged
- Indexed by executionId, correlationId, clientOrderId
- 90-day retention policy
- Audit trail queries for compliance
- Recovery reconstruction

### 6. Restart-Safe Recovery
**File:** `server/_core/restart-recovery.ts`

- Recover all in-flight executions from journal
- Reconstruct portfolio state
- Validate against exchange
- Resume pending orders
- Handles crashes/restarts gracefully

## Execution Flow

WEBSOCKET EVENT ↓
ORCHESTRATOR EMITS STREAM EVENT ↓
DETERMINISTIC ENGINE CREATES EXECUTION CONTEXT ├─ Generate executionId + correlationId ├─ Generate stable clientOrderId └─ Persist for recovery ↓
RISK ENGINE EVALUATES TRADE ├─ 12 gates (6 hard + 6 soft) ├─ Portfolio health scoring └─ APPROVED/CONDITIONAL/REJECTED ↓
ACQUIRE DISTRIBUTED LOCK ├─ Redis lock per market/order ├─ Prevents duplicate submission └─ TTL 30 seconds ↓
SUBMIT TO EXCHANGE ├─ Transition: LOCKED → SUBMITTED ├─ Exchange API call └─ Log to journal ↓
MONITOR LIFECYCLE ├─ WebSocket fill updates ├─ Partial fill handling ├─ Stale order cancellation └─ Transition: SUBMITTED → ACCEPTED → FILLED ↓
RECORD METRICS ├─ Prometheus metrics ├─ Structured logs └─ OTEL traces

## Deployment Model

Ubuntu Server ├── systemd (service management) ├── PM2 (process orchestration) ├── Fastify/Express (HTTP API) ├── BullMQ Workers (execution processors) ├── Redis (locks + queues) ├── PostgreSQL (persistent state) ├── Exchange Stream Handlers (WebSocket clients) ├── Deterministic Execution Engine ├── Risk Engine ├── Memory/Analytics Workers ├── OpenTelemetry Exporter ├── Prometheus Client ├── Grafana (dashboards) └── Sentry (error tracking)

## Security & Hardening

- **Runtime Secret Redaction:** All logs redact private keys, API keys, tokens
- **Dependency Pinning:** All versions pinned for reproducibility
- **SBOM Generation:** Software bill of materials for supply chain transparency
- **Permission Boundaries:** Execution cannot bypass risk gates
- **Distributed Locking:** Redis locks prevent concurrent duplicate submission
- **Immutable Audit Trail:** Append-only journal prevents tampering
- **Restart Recovery:** Crashes cannot cause orphaned orders

## Testing Strategy

- **Deterministic Replay:** All trades can be replayed from journal
- **Duplicate Order Simulation:** Test lock acquisition under contention
- **WebSocket Disconnect Simulation:** Test fallback polling activation
- **Restart Recovery Testing:** Crash/restart scenarios
- **Chaos Testing:** Random failures, latency injection
- **Reconciliation Validation:** Exchange state vs. local state
- **Partial Fill Simulation:** Test partial fill handling
- **Latency Injection Testing:** Test timeout handling
- **Corrupted Payload Testing:** Test error recovery
- **E2E Exchange Simulation:** Full lifecycle testing
- **Green CI:** All tests passing before deployment

## Operational Readiness

### Prerequisites
- Redis (v6+) — execution locks, queue broker
- PostgreSQL (v13+) — persistent state, journal storage
- Ubuntu Server (20.04+) — deployment platform

### Bootstrap (One Command)
```bash
./install.sh
```
This installs:
- Node.js dependencies
- Database migrations
- Service configuration
- PM2 ecosystem setup

### Configuration
- Copy .env.example to .env
- Set exchange credentials (Polymarket, Kalshi)
- Set LLM provider keys (OpenAI, Anthropic, Groq)
- Set risk limits (max position, drawdown, etc.)
- Set observability endpoints (OTEL, Prometheus, Sentry)

### Runtime Operations
- Dashboard (operator console)
- Live log streaming
- Metrics visualization (Grafana)
- Error tracking (Sentry)
- Manual order override (if needed)

### Acquisition Readiness
✓ Deterministic execution ✓ Replay-safe order lifecycle ✓ Zero duplicate-order risk ✓ WebSocket-first ingestion ✓ Polling only as reconciliation fallback ✓ Bounded worker orchestration ✓ Institutional observability ✓ Append-only auditability ✓ Restart-safe recovery ✓ Hardened risk enforcement ✓ Constrained LLM governance ✓ Reproducible deployment ✓ Operationally autonomous runtime ✓ No fake functionality ✓ No dead paths ✓ Production-grade hardening
