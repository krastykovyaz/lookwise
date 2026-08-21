-- Add updatedAt (current-state tracking for product-scoped signals).
-- SQLite requires a constant default for a NOT NULL column added to a
-- non-empty table; backfill it to createdAt right after so existing
-- rows get a sensible "last changed" value instead of a placeholder.
ALTER TABLE `preference_signal` ADD `updatedAt` integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE `preference_signal` SET `updatedAt` = `createdAt` WHERE `updatedAt` = 0;--> statement-breakpoint
-- Collapse any pre-existing duplicate (userId, productId) rows down to
-- the most recent one before the unique index below can be created —
-- the prior blind-insert repository let repeated like/dislike clicks
-- accumulate multiple rows for the same product. This does not affect
-- look-scoped rows (productId IS NULL), which are left untouched.
DELETE FROM `preference_signal`
WHERE `productId` IS NOT NULL
AND `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (
      PARTITION BY `userId`, `productId`
      ORDER BY `updatedAt` DESC, `createdAt` DESC, `id` DESC
    ) AS rn
    FROM `preference_signal`
    WHERE `productId` IS NOT NULL
  )
  WHERE rn = 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `preference_signal_user_product_uq` ON `preference_signal` (`userId`,`productId`) WHERE "preference_signal"."productId" is not null;
