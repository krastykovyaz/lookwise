CREATE TABLE `account` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`lastLoginAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`type` text NOT NULL,
	`productId` text,
	`lookId` text,
	`category` text,
	`brand` text,
	`price` real,
	`source` text,
	`metadata` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_user_idx` ON `event` (`userId`);--> statement-breakpoint
CREATE INDEX `event_type_idx` ON `event` (`type`);--> statement-breakpoint
CREATE TABLE `look_product` (
	`id` text PRIMARY KEY NOT NULL,
	`lookId` text NOT NULL,
	`productId` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`role` text,
	FOREIGN KEY (`lookId`) REFERENCES `look`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `look_product_look_idx` ON `look_product` (`lookId`);--> statement-breakpoint
CREATE TABLE `look` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`title` text NOT NULL,
	`description` text,
	`language` text,
	`gender` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `preference_signal` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`productId` text,
	`lookId` text,
	`signalType` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `preference_signal_user_idx` ON `preference_signal` (`userId`);--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'ebay' NOT NULL,
	`providerItemId` text NOT NULL,
	`title` text NOT NULL,
	`brand` text,
	`category` text,
	`gender` text,
	`price` real,
	`currency` text,
	`condition` text,
	`sellerId` text,
	`sellerName` text,
	`imageUrl` text,
	`productUrl` text,
	`availability` text,
	`lastSeenAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`sellerId`) REFERENCES `seller`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_provider_item_uq` ON `product` (`provider`,`providerItemId`);--> statement-breakpoint
CREATE INDEX `product_provider_item_idx` ON `product` (`providerItemId`);--> statement-breakpoint
CREATE INDEX `product_brand_idx` ON `product` (`brand`);--> statement-breakpoint
CREATE INDEX `product_category_idx` ON `product` (`category`);--> statement-breakpoint
CREATE INDEX `product_gender_idx` ON `product` (`gender`);--> statement-breakpoint
CREATE INDEX `product_seller_idx` ON `product` (`sellerId`);--> statement-breakpoint
CREATE INDEX `product_updated_idx` ON `product` (`updatedAt`);--> statement-breakpoint
CREATE TABLE `saved_look` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`lookId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_look_user_look_uq` ON `saved_look` (`userId`,`lookId`);--> statement-breakpoint
CREATE INDEX `saved_look_user_idx` ON `saved_look` (`userId`);--> statement-breakpoint
CREATE TABLE `saved_product` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`productId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_product_user_product_uq` ON `saved_product` (`userId`,`productId`);--> statement-breakpoint
CREATE INDEX `saved_product_user_idx` ON `saved_product` (`userId`);--> statement-breakpoint
CREATE TABLE `seller` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'ebay' NOT NULL,
	`providerSellerId` text NOT NULL,
	`name` text NOT NULL,
	`rating` real,
	`feedbackCount` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seller_provider_id_uq` ON `seller` (`provider`,`providerSellerId`);--> statement-breakpoint
CREATE TABLE `style_profile` (
	`userId` text PRIMARY KEY NOT NULL,
	`styleArchetypes` text DEFAULT '[]' NOT NULL,
	`preferredFit` text,
	`preferredColors` text DEFAULT '[]' NOT NULL,
	`dislikedColors` text DEFAULT '[]' NOT NULL,
	`preferredBrands` text DEFAULT '[]' NOT NULL,
	`dislikedBrands` text DEFAULT '[]' NOT NULL,
	`budgetRange` text,
	`locationCity` text,
	`locationCountry` text,
	`locationLatitude` real,
	`locationLongitude` real,
	`locationTimezone` text,
	`locationSource` text,
	`favoriteCategories` text DEFAULT '[]' NOT NULL,
	`dislikedCategories` text DEFAULT '[]' NOT NULL,
	`genderPreference` text,
	`intent` text,
	`mood` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `viewed_product` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`productId` text NOT NULL,
	`provider` text DEFAULT 'ebay' NOT NULL,
	`viewedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `viewed_product_user_idx` ON `viewed_product` (`userId`);--> statement-breakpoint
CREATE INDEX `viewed_product_product_idx` ON `viewed_product` (`productId`);