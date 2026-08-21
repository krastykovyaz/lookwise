CREATE TABLE `technical_log` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `technical_log_created_at_idx` ON `technical_log` (`createdAt`);--> statement-breakpoint
ALTER TABLE `product` ADD `availabilityStatus` text DEFAULT 'AVAILABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE `product` ADD `unavailableAt` integer;--> statement-breakpoint
CREATE INDEX `product_availability_status_idx` ON `product` (`availabilityStatus`);--> statement-breakpoint
CREATE INDEX `product_unavailable_at_idx` ON `product` (`unavailableAt`);--> statement-breakpoint
CREATE INDEX `referral_visit_created_at_idx` ON `referral_visit` (`createdAt`);