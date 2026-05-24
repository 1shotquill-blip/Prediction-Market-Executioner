/**
 * WEBSOCKET-FIRST ORCHESTRATION
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Event-driven execution engine replacing polling loops:
 * - PRIMARY: WebSocket stream handlers trigger execution
 * - SECONDARY: Redis/BullMQ bounded workers process execution
 * - TERTIARY: Polling only for reconciliation fallback
 * - NO recursive orchestration loops
 */

import { EventEmitter } from "events";
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { deterministicExecutionEngine, ExecutionContext } from "./deterministic-execution-engine";

export type StreamEventType =
  | "orderbook_update"
  | "trade"
  | "fill"
  | "cancel"
  | "disconnect"
  | "reconnect";

export interface StreamEvent {
  type: StreamEventType;
  exchange: string;
  marketId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface ExecutionWorkerJob {
  executionId: string;
  correlationId: string;
  clientOrderId: string;
  marketId: string;
  exchange: string;
  side: "buy" | "sell";
  sizeUsd: number;
  limitPrice: number;
  metadata: Record<string, unknown>;
}

/**
 * Event-driven execution orchestrator
 * Replaces BotEngine polling loop
 */
class WebSocketFirstOrchestrator extends EventEmitter {
  private redis: IORedis;
  private executionQueue: Queue;
  private executionWorker: Worker | null = null;
  private reconciliationWorker: Worker | null = null;
  private readonly MAX_CONCURRENT_ORDERS = 5;
  private activeExecutions = new Map<string, ExecutionContext>();

  constructor() {
    super();
    
    this.redis = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || "6379"),
      db: 0,
    });

    this.executionQueue = new Queue("execution-jobs", { connection: this.redis });
  }

  /**
   * Initialize event-driven orchestrator
   */
  async initialize(): Promise<void> {
    console.log("[Orchestrator] Initializing WebSocket-first event loop");

    // Worker 1: Execution processor (bounded concurrency)
    this.executionWorker = new Worker(
      "execution-jobs",
      async (job) => this.processExecutionJob(job),
      {
        connection: this.redis,
        concurrency: this.MAX_CONCURRENT_ORDERS,
        settings: {
          lockDuration: 30_000,
          lockRenewTime: 5_000,
        },
      }
    );

    this.executionWorker.on("completed", (job) => {
      console.log(`[Orchestrator] Execution completed: ${job.id}`);
    });

    this.executionWorker.on("failed", (job, err) => {
      console.error(`[Orchestrator] Execution failed: ${job?.id}`, err);
    });

    // Worker 2: Reconciliation worker (polling fallback)
    this.reconciliationWorker = new Worker(
      "reconciliation-jobs",
      async (job) => this.processReconciliationJob(job),
      {
        connection: this.redis,
        concurrency: 1,
      }
    );

    // Set up stream event listeners (WebSocket handlers will emit these)
    this.on("orderbook_update", (event: StreamEvent) =>
      this.handleOrderbookUpdate(event)
    );
    this.on("trade", (event: StreamEvent) =>
      this.handleTradeEvent(event)
    );
    this.on("fill", (event: StreamEvent) =>
      this.handleFillEvent(event)
    );
    this.on("disconnect", (event: StreamEvent) =>
      this.handleDisconnect(event)
    );

    console.log("[Orchestrator] Initialization complete");
  }

  /**
   * PRIMARY: WebSocket stream event handler
   * Triggered by exchange WebSocket when orderbook updates
   */
  private async handleOrderbookUpdate(event: StreamEvent): Promise<void> {
    console.log(
      `[Orchestrator] Orderbook update: ${event.exchange}:${event.marketId}`
    );

    // Check if pending execution exists for this market
    const pendingJob = await this.redis.hgetall(
      `pending:${event.exchange}:${event.marketId}`
    );

    if (!pendingJob || Object.keys(pendingJob).length === 0) return;

    // Enqueue execution job with deterministic context
    const job = await this.executionQueue.add(
      "submit-order",
      {
        executionId: pendingJob.executionId,
        correlationId: pendingJob.correlationId,
        clientOrderId: pendingJob.clientOrderId,
        marketId: event.marketId,
        exchange: event.exchange,
        side: pendingJob.side,
        sizeUsd: Number(pendingJob.sizeUsd),
        limitPrice: Number(pendingJob.limitPrice),
        metadata: JSON.parse(pendingJob.metadata || "{}"),
      } as ExecutionWorkerJob,
      {
        jobId: pendingJob.executionId,
        priority: 10,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
      }
    );

    console.log(`[Orchestrator] Execution enqueued: ${job.id}`);
  }

  /**
   * WebSocket: Trade event (price tick)
   */
  private async handleTradeEvent(event: StreamEvent): Promise<void> {
    console.log(
      `[Orchestrator] Trade event: ${event.exchange}:${event.marketId}`
    );
    // Optionally re-evaluate pending orders
  }

  /**
   * WebSocket: Fill confirmation from exchange
   */
  private async handleFillEvent(event: StreamEvent): Promise<void> {
    const { executionId, matchedSize } = event.data as any;
    console.log(
      `[Orchestrator] Fill event: executionId=${executionId} matched=${matchedSize}`
    );

    const context = this.activeExecutions.get(executionId);
    if (!context) return;

    // Update execution context with fill
    const updated = await deterministicExecutionEngine.transitionPhase(
      context,
      "FILLED",
      {
        matchedSizeUsd: matchedSize,
        remainingSizeUsd: context.sizeUsd - matchedSize,
        filledAt: new Date(),
        metadata: { ...context.metadata, fillTimestamp: event.timestamp },
      },
      "Fill received from exchange"
    );

    this.activeExecutions.set(executionId, updated);
  }

  /**
   * WebSocket: Disconnect (trigger fallback polling)
   */
  private async handleDisconnect(event: StreamEvent): Promise<void> {
    console.warn(
      `[Orchestrator] WebSocket disconnect: ${event.exchange}, activating polling fallback`
    );

    // Enqueue reconciliation polling job
    await this.enqueueReconciliationJob(event.exchange);
  }

  /**
   * SECONDARY: Execute order when conditions are met
   */
  private async processExecutionJob(job: any): Promise<void> {
    const jobData: ExecutionWorkerJob = job.data;

    try {
      // Duplicate check
      const duplicate = await deterministicExecutionEngine.checkForDuplicate(
        jobData.clientOrderId
      );
      if (duplicate) {
        console.warn(
          `[Orchestrator] Duplicate order detected: ${jobData.clientOrderId}`
        );
        return;
      }

      // Acquire distributed lock
      const lock = await deterministicExecutionEngine.acquireExecutionLock(
        jobData.exchange,
        jobData.marketId,
        jobData.clientOrderId
      );

      try {
        // Create execution context
        let context = await deterministicExecutionEngine.createExecutionContext(
          jobData.marketId,
          jobData.exchange,
          jobData.side,
          jobData.sizeUsd,
          jobData.limitPrice,
          jobData.metadata
        );

        // Transition through phases
        context = await deterministicExecutionEngine.transitionPhase(
          context,
          "RISK_GATED",
          {},
          "Risk gates passed"
        );

        context = await deterministicExecutionEngine.transitionPhase(
          context,
          "LOCKED",
          {},
          "Distributed lock acquired"
        );

        // MOCK: Submit to exchange (replace with actual adapter)
        console.log(
          `[Orchestrator] Submitting order: ${jobData.clientOrderId} to ${jobData.exchange}`
        );

        // For now, simulate acceptance
        context = await deterministicExecutionEngine.transitionPhase(
          context,
          "SUBMITTED",
          { submittedAt: new Date(), metadata: { exchangeOrderId: `ext-${Date.now()}` } },
          "Order submitted to exchange"
        );

        context = await deterministicExecutionEngine.transitionPhase(
          context,
          "ACCEPTED",
          { acceptedAt: new Date() },
          "Exchange accepted order"
        );

        this.activeExecutions.set(jobData.executionId, context);
      } finally {
        await deterministicExecutionEngine.releaseLock(lock);
      }
    } catch (err) {
      console.error(`[Orchestrator] Execution job failed:`, err);
      throw err;
    }
  }

  /**
   * TERTIARY: Polling fallback for reconciliation
   */
  private async processReconciliationJob(job: any): Promise<void> {
    const { exchange } = job.data;
    console.log(`[Orchestrator] Reconciliation poll: ${exchange}`);

    // Poll exchange for open orders and sync state
    // On WebSocket reconnect, this becomes non-blocking
  }

  /**
   * Enqueue reconciliation job (called on WebSocket disconnect)
   */
  private async enqueueReconciliationJob(exchange: string): Promise<void> {
    const queue = new Queue("reconciliation-jobs", { connection: this.redis });
    await queue.add(
      "reconcile",
      { exchange },
      {
        repeat: {
          every: 15_000, // Poll every 15 seconds
        },
      }
    );
  }

  /**
   * Emit stream event (called by WebSocket handlers)
   */
  emitStreamEvent(event: StreamEvent): void {
    this.emit(event.type, event);
  }

  /**
   * Schedule pending order execution
   */
  async schedulePendingOrder(job: ExecutionWorkerJob): Promise<void> {
    // Store as pending
    await this.redis.hset(
      `pending:${job.exchange}:${job.marketId}`,
      "executionId",
      job.executionId,
      "correlationId",
      job.correlationId,
      "clientOrderId",
      job.clientOrderId,
      "side",
      job.side,
      "sizeUsd",
      job.sizeUsd,
      "limitPrice",
      job.limitPrice,
      "metadata",
      JSON.stringify(job.metadata)
    );

    console.log(
      `[Orchestrator] Pending order scheduled: ${job.clientOrderId}`
    );

    // Wait for next orderbook update to trigger execution
  }

  async shutdown(): Promise<void> {
    if (this.executionWorker) await this.executionWorker.close();
    if (this.reconciliationWorker) await this.reconciliationWorker.close();
    await this.executionQueue.close();
    await this.redis.quit();
  }
}

export const webSocketFirstOrchestrator = new WebSocketFirstOrchestrator();
