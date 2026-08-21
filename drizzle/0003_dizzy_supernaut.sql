CREATE TABLE `viewed_look` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`lookId` text NOT NULL,
	`snapshotLookId` text,
	`viewedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshotLookId`) REFERENCES `look`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `viewed_look_user_idx` ON `viewed_look` (`userId`);--> statement-breakpoint
ALTER TABLE `saved_look` ADD `snapshotLookId` text REFERENCES look(id);