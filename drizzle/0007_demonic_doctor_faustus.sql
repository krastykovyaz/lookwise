CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`entityType` text,
	`entityId` text,
	`dedupeKey` text,
	`readAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notification_user_created_idx` ON `notification` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `notification_user_read_idx` ON `notification` (`userId`,`readAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_user_dedupe_uq` ON `notification` (`userId`,`dedupeKey`) WHERE "notification"."dedupeKey" is not null;