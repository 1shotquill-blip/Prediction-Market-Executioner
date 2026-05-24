ALTER TABLE `orders` MODIFY COLUMN `status` enum('pending','partially_filled','filled','cancel_requested','cancelled','expired','rejected') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `orders` ADD `exchangeOrderId` varchar(256);--> statement-breakpoint
ALTER TABLE `orders` ADD `matchedSize` decimal(18,6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `lifecycleState` enum('INTENT_CREATED','ORDER_SIGNED','ORDER_POSTED','ACCEPTED_BY_CLOB','PARTIALLY_FILLED','FILLED','CANCEL_REQUESTED','CANCEL_CONFIRMED','EXPIRED','REJECTED','RECONCILIATION_MISMATCH') DEFAULT 'INTENT_CREATED' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `rejectionReason` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `acceptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `orders` ADD `lastSyncedAt` timestamp;--> statement-breakpoint
CREATE INDEX `idx_exchangeOrderId` ON `orders` (`exchangeOrderId`);--> statement-breakpoint
CREATE INDEX `idx_lifecycleState` ON `orders` (`lifecycleState`);