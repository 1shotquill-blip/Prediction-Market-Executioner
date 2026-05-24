CREATE TABLE `bayesian_priors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(100) NOT NULL,
	`priorProbability` decimal(3,2) NOT NULL,
	`sampleSize` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bayesian_priors_id` PRIMARY KEY(`id`),
	CONSTRAINT `bayesian_priors_category_unique` UNIQUE(`category`)
);
--> statement-breakpoint
CREATE TABLE `bot_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`executionMode` enum('paper','live') NOT NULL DEFAULT 'paper',
	`isRunning` int NOT NULL DEFAULT 1,
	`isPaused` int NOT NULL DEFAULT 0,
	`emergencyBrakeTriggered` int NOT NULL DEFAULT 0,
	`edgeThreshold` decimal(10,6) NOT NULL DEFAULT '0.05',
	`kellyFraction` decimal(3,2) NOT NULL DEFAULT '0.25',
	`maxSpread` decimal(10,6) NOT NULL DEFAULT '0.05',
	`maxSingleExposure` decimal(5,2) NOT NULL DEFAULT '5',
	`maxTotalExposure` decimal(5,2) NOT NULL DEFAULT '30',
	`drawdownLimit` decimal(5,2) NOT NULL DEFAULT '15',
	`minVolume24h` decimal(18,6) NOT NULL DEFAULT '1000',
	`minConfidence` decimal(3,2) NOT NULL DEFAULT '0.6',
	`orderTimeoutSeconds` int NOT NULL DEFAULT 30,
	`pollingIntervalSeconds` int NOT NULL DEFAULT 15,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bot_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `equity_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`balance` decimal(18,6) NOT NULL,
	`peakBalance` decimal(18,6) NOT NULL,
	`drawdown` decimal(5,2) NOT NULL,
	`totalExposure` decimal(5,2) NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equity_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `markets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`marketId` varchar(256) NOT NULL,
	`question` text NOT NULL,
	`category` varchar(100),
	`volume24h` decimal(18,6),
	`bestBid` decimal(10,6),
	`bestAsk` decimal(10,6),
	`spread` decimal(10,6),
	`expiresAt` timestamp,
	`lastUpdatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `markets_id` PRIMARY KEY(`id`),
	CONSTRAINT `markets_marketId_unique` UNIQUE(`marketId`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nonce` varchar(256) NOT NULL,
	`marketId` varchar(256) NOT NULL,
	`tokenId` varchar(256) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`price` decimal(10,6) NOT NULL,
	`size` decimal(18,6) NOT NULL,
	`status` enum('pending','filled','cancelled','expired') NOT NULL DEFAULT 'pending',
	`edgeAtPlacement` decimal(10,6),
	`confidenceAtPlacement` decimal(3,2),
	`placedAt` timestamp NOT NULL DEFAULT (now()),
	`filledAt` timestamp,
	`cancelledAt` timestamp,
	`expiresAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_nonce_unique` UNIQUE(`nonce`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`marketId` varchar(256) NOT NULL,
	`source` varchar(50) NOT NULL,
	`content` text,
	`sentimentScore` decimal(3,2),
	`confidence` decimal(3,2),
	`metadata` json,
	`collectedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`marketId` varchar(256) NOT NULL,
	`tokenId` varchar(256) NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`price` decimal(10,6) NOT NULL,
	`size` decimal(18,6) NOT NULL,
	`usdcValue` decimal(18,6) NOT NULL,
	`edgeAtTrade` decimal(10,6),
	`confidenceAtTrade` decimal(3,2),
	`filledAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_category_priors` ON `bayesian_priors` (`category`);--> statement-breakpoint
CREATE INDEX `idx_timestamp` ON `equity_snapshots` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_marketId` ON `markets` (`marketId`);--> statement-breakpoint
CREATE INDEX `idx_category` ON `markets` (`category`);--> statement-breakpoint
CREATE INDEX `idx_marketId_orders` ON `orders` (`marketId`);--> statement-breakpoint
CREATE INDEX `idx_nonce` ON `orders` (`nonce`);--> statement-breakpoint
CREATE INDEX `idx_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_marketId_signals` ON `signals` (`marketId`);--> statement-breakpoint
CREATE INDEX `idx_source` ON `signals` (`source`);--> statement-breakpoint
CREATE INDEX `idx_marketId_trades` ON `trades` (`marketId`);--> statement-breakpoint
CREATE INDEX `idx_orderId` ON `trades` (`orderId`);