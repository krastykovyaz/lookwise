-- Pre-existing rows may already have duplicates for the same
-- (userId, productId/lookId) pair (that's exactly the bug these
-- unique indexes fix — see activity.ts's recordViewedProduct/
-- recordViewedLook comments), so dedupe first, keeping only the
-- most-recently-viewed row per pair, or CREATE UNIQUE INDEX below
-- would fail on a live database with existing duplicates.
DELETE FROM `viewed_look`
WHERE `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (
      PARTITION BY `userId`, `lookId` ORDER BY `viewedAt` DESC, `id` DESC
    ) AS rn
    FROM `viewed_look`
  ) WHERE rn = 1
);
--> statement-breakpoint
DELETE FROM `viewed_product`
WHERE `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (
      PARTITION BY `userId`, `productId` ORDER BY `viewedAt` DESC, `id` DESC
    ) AS rn
    FROM `viewed_product`
  ) WHERE rn = 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `viewed_look_user_look_uq` ON `viewed_look` (`userId`,`lookId`);--> statement-breakpoint
CREATE UNIQUE INDEX `viewed_product_user_product_uq` ON `viewed_product` (`userId`,`productId`);