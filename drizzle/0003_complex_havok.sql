CREATE TABLE `decision_audits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tickId` varchar(128) NOT NULL,
	`marketId` varchar(256) NOT NULL,
	`question` text NOT NULL,
	`action` enum('skipped','paper_order_submitted','live_order_submitted') NOT NULL,
	`reasons` json,
	`estimatedProbability` decimal(10,6),
	`confidence` decimal(3,2),
	`edge` decimal(10,6),
	`bestBid` decimal(10,6),
	`bestAsk` decimal(10,6),
	`spread` decimal(10,6),
	`orderNonce` varchar(256),
	`exchangeOrderId` varchar(256),
	`lifecycleStatus` varchar(64),
	`diagnostics` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `decision_audits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_decision_tickId` ON `decision_audits` (`tickId`);--> statement-breakpoint
CREATE INDEX `idx_decision_marketId` ON `decision_audits` (`marketId`);--> statement-breakpoint
CREATE INDEX `idx_decision_action` ON `decision_audits` (`action`);--> statement-breakpoint
CREATE INDEX `idx_decision_createdAt` ON `decision_audits` (`createdAt`);