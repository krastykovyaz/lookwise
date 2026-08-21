CREATE TABLE `referral_visit` (
	`id` text PRIMARY KEY NOT NULL,
	`referralCode` text NOT NULL,
	`sourceType` text NOT NULL,
	`sourceId` text NOT NULL,
	`visitorId` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `referral_visit_code_idx` ON `referral_visit` (`referralCode`);--> statement-breakpoint
CREATE INDEX `referral_visit_visitor_idx` ON `referral_visit` (`visitorId`);--> statement-breakpoint
CREATE TABLE `referral` (
	`id` text PRIMARY KEY NOT NULL,
	`referrerUserId` text NOT NULL,
	`referredUserId` text NOT NULL,
	`sourceType` text,
	`sourceId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`referrerUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referredUserId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_referred_user_uq` ON `referral` (`referredUserId`);--> statement-breakpoint
CREATE INDEX `referral_referrer_idx` ON `referral` (`referrerUserId`);--> statement-breakpoint
ALTER TABLE `user` ADD `referralCode` text;--> statement-breakpoint
CREATE UNIQUE INDEX `user_referralCode_unique` ON `user` (`referralCode`);