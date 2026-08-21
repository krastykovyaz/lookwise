CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text DEFAULT 'nowpayments' NOT NULL,
	`providerPaymentId` text NOT NULL,
	`orderId` text NOT NULL,
	`priceAmount` real NOT NULL,
	`priceCurrency` text NOT NULL,
	`payCurrency` text,
	`payAmount` real,
	`payAddress` text,
	`status` text DEFAULT 'waiting' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`completedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_payment_id_uq` ON `payment` (`provider`,`providerPaymentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_order_id_uq` ON `payment` (`orderId`);--> statement-breakpoint
CREATE INDEX `payment_user_idx` ON `payment` (`userId`);--> statement-breakpoint
CREATE INDEX `payment_user_status_idx` ON `payment` (`userId`,`status`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`startedAt` integer NOT NULL,
	`expiresAt` integer NOT NULL,
	`paymentId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`paymentId`) REFERENCES `payment`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `subscription_user_idx` ON `subscription` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_payment_uq` ON `subscription` (`paymentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_user_active_uq` ON `subscription` (`userId`,`status`) WHERE "subscription"."status" = 'active';