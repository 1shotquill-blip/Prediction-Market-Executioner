import "dotenv/config";
import express from "express";
import { BotEngine } from "../bot-engine";
import { registerBot } from "./bot-singleton";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { printStartupBanner } from "./startup-banner";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function runMigrations() {
  if (!process.env.DATABASE_URL) return;
  try {
    const { createConnection } = await import("mysql2/promise");
    const conn = await createConnection({ uri: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectTimeout: 15000 });
    const tables = [
      `CREATE TABLE IF NOT EXISTS \`users\` (\`id\` int AUTO_INCREMENT NOT NULL,\`openId\` varchar(64) NOT NULL,\`name\` text,\`email\` varchar(320),\`loginMethod\` varchar(64),\`role\` enum('user','admin') NOT NULL DEFAULT 'user',\`createdAt\` timestamp NOT NULL DEFAULT (now()),\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,\`lastSignedIn\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`users_id\` PRIMARY KEY(\`id\`),CONSTRAINT \`users_openId_unique\` UNIQUE(\`openId\`))`,
      `CREATE TABLE IF NOT EXISTS \`bayesian_priors\` (\`id\` int AUTO_INCREMENT NOT NULL,\`category\` varchar(100) NOT NULL,\`priorProbability\` decimal(3,2) NOT NULL,\`sampleSize\` int NOT NULL DEFAULT 0,\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`bayesian_priors_id\` PRIMARY KEY(\`id\`),CONSTRAINT \`bayesian_priors_category_unique\` UNIQUE(\`category\`))`,
      `CREATE TABLE IF NOT EXISTS \`bot_config\` (\`id\` int AUTO_INCREMENT NOT NULL,\`executionMode\` enum('paper','live') NOT NULL DEFAULT 'paper',\`isRunning\` int NOT NULL DEFAULT 1,\`isPaused\` int NOT NULL DEFAULT 0,\`emergencyBrakeTriggered\` int NOT NULL DEFAULT 0,\`edgeThreshold\` decimal(10,6) NOT NULL DEFAULT '0.05',\`kellyFraction\` decimal(3,2) NOT NULL DEFAULT '0.25',\`maxSpread\` decimal(10,6) NOT NULL DEFAULT '0.05',\`maxSingleExposure\` decimal(5,2) NOT NULL DEFAULT '5',\`maxTotalExposure\` decimal(5,2) NOT NULL DEFAULT '30',\`drawdownLimit\` decimal(5,2) NOT NULL DEFAULT '15',\`minVolume24h\` decimal(18,6) NOT NULL DEFAULT '1000',\`minConfidence\` decimal(3,2) NOT NULL DEFAULT '0.6',\`orderTimeoutSeconds\` int NOT NULL DEFAULT 30,\`pollingIntervalSeconds\` int NOT NULL DEFAULT 15,\`updatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,CONSTRAINT \`bot_config_id\` PRIMARY KEY(\`id\`))`,
      `CREATE TABLE IF NOT EXISTS \`equity_snapshots\` (\`id\` int AUTO_INCREMENT NOT NULL,\`balance\` decimal(18,6) NOT NULL,\`peakBalance\` decimal(18,6) NOT NULL,\`drawdown\` decimal(5,2) NOT NULL,\`totalExposure\` decimal(5,2) NOT NULL,\`timestamp\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`equity_snapshots_id\` PRIMARY KEY(\`id\`))`,
      `CREATE TABLE IF NOT EXISTS \`markets\` (\`id\` int AUTO_INCREMENT NOT NULL,\`marketId\` varchar(256) NOT NULL,\`question\` text NOT NULL,\`category\` varchar(100),\`volume24h\` decimal(18,6),\`bestBid\` decimal(10,6),\`bestAsk\` decimal(10,6),\`spread\` decimal(10,6),\`expiresAt\` timestamp NULL,\`lastUpdatedAt\` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,\`createdAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`markets_id\` PRIMARY KEY(\`id\`),CONSTRAINT \`markets_marketId_unique\` UNIQUE(\`marketId\`))`,
      `CREATE TABLE IF NOT EXISTS \`signals\` (\`id\` int AUTO_INCREMENT NOT NULL,\`marketId\` varchar(256) NOT NULL,\`source\` varchar(50) NOT NULL,\`content\` text,\`sentimentScore\` decimal(3,2),\`confidence\` decimal(3,2),\`metadata\` json,\`collectedAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`signals_id\` PRIMARY KEY(\`id\`))`,
      `CREATE TABLE IF NOT EXISTS \`orders\` (\`id\` int AUTO_INCREMENT NOT NULL,\`nonce\` varchar(256) NOT NULL,\`exchangeOrderId\` varchar(256),\`marketId\` varchar(256) NOT NULL,\`tokenId\` varchar(256) NOT NULL,\`side\` enum('buy','sell') NOT NULL,\`price\` decimal(10,6) NOT NULL,\`size\` decimal(18,6) NOT NULL,\`matchedSize\` decimal(18,6) NOT NULL DEFAULT '0',\`status\` enum('pending','partially_filled','filled','cancel_requested','cancelled','expired','rejected') NOT NULL DEFAULT 'pending',\`lifecycleState\` enum('INTENT_CREATED','ORDER_SIGNED','ORDER_POSTED','ACCEPTED_BY_CLOB','PARTIALLY_FILLED','FILLED','CANCEL_REQUESTED','CANCEL_CONFIRMED','EXPIRED','REJECTED','RECONCILIATION_MISMATCH') NOT NULL DEFAULT 'INTENT_CREATED',\`edgeAtPlacement\` decimal(10,6),\`confidenceAtPlacement\` decimal(3,2),\`rejectionReason\` text,\`placedAt\` timestamp NOT NULL DEFAULT (now()),\`acceptedAt\` timestamp NULL,\`filledAt\` timestamp NULL,\`lastSyncedAt\` timestamp NULL,\`cancelledAt\` timestamp NULL,\`expiresAt\` timestamp NULL,CONSTRAINT \`orders_id\` PRIMARY KEY(\`id\`),CONSTRAINT \`orders_nonce_unique\` UNIQUE(\`nonce\`))`,
      `CREATE TABLE IF NOT EXISTS \`trades\` (\`id\` int AUTO_INCREMENT NOT NULL,\`orderId\` int NOT NULL,\`marketId\` varchar(256) NOT NULL,\`tokenId\` varchar(256) NOT NULL,\`side\` enum('buy','sell') NOT NULL,\`price\` decimal(10,6) NOT NULL,\`size\` decimal(18,6) NOT NULL,\`usdcValue\` decimal(18,6) NOT NULL,\`edgeAtTrade\` decimal(10,6),\`confidenceAtTrade\` decimal(3,2),\`filledAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`trades_id\` PRIMARY KEY(\`id\`))`,
      `CREATE TABLE IF NOT EXISTS \`decision_audits\` (\`id\` int AUTO_INCREMENT NOT NULL,\`tickId\` varchar(128) NOT NULL,\`marketId\` varchar(256) NOT NULL,\`question\` text NOT NULL,\`action\` enum('skipped','paper_order_submitted','live_order_submitted') NOT NULL,\`reasons\` json,\`estimatedProbability\` decimal(10,6),\`confidence\` decimal(3,2),\`edge\` decimal(10,6),\`bestBid\` decimal(10,6),\`bestAsk\` decimal(10,6),\`spread\` decimal(10,6),\`selectionScore\` decimal(10,6),\`orderNonce\` varchar(256),\`exchangeOrderId\` varchar(256),\`lifecycleStatus\` varchar(64),\`diagnostics\` json,\`createdAt\` timestamp NOT NULL DEFAULT (now()),CONSTRAINT \`decision_audits_id\` PRIMARY KEY(\`id\`))`,
    ];
    for (const sql of tables) await conn.query(sql);
    // Seed default bot_config row so the bot always has a config to read
    await conn.query(`
      INSERT IGNORE INTO \`bot_config\` (id, executionMode, isRunning, isPaused, emergencyBrakeTriggered,
        edgeThreshold, kellyFraction, maxSpread, maxSingleExposure, maxTotalExposure,
        drawdownLimit, minVolume24h, minConfidence, orderTimeoutSeconds, pollingIntervalSeconds)
      VALUES (1, 'paper', 1, 0, 0, 0.05, 0.25, 0.05, 5, 30, 15, 1000, 0.6, 30, 15)
    `);
    await conn.end();
    console.info("[DB] Schema migration complete");
  } catch (e) {
    console.error("[DB] Migration error:", (e as Error).message);
  }
}

async function startServer() {
  await runMigrations();
  await printStartupBanner();
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.warn(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.info(`Server running on http://localhost:${port}/`);
  });

  // Auto-start the trading bot and register the singleton for route handlers.
  const bot = new BotEngine();
  registerBot(bot);
  bot.start().catch(e => console.error("[Bot] Auto-start failed:", e));
}

startServer().catch(console.error);
