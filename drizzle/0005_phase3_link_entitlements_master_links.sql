ALTER TABLE `settings` ADD COLUMN `link_mode` text DEFAULT 'standalone' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `people_source` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `targets_source` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `periods_source` text DEFAULT 'local' NOT NULL;
--> statement-breakpoint
CREATE TABLE `master_links` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `kind` text NOT NULL,
  `local_key` text NOT NULL,
  `local_name` text DEFAULT '' NOT NULL,
  `linked_name` text DEFAULT '' NOT NULL,
  `linked_id` text DEFAULT '' NOT NULL,
  `status` text DEFAULT 'unmatched' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `product_entitlements` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `school_name` text DEFAULT '' NOT NULL,
  `product` text NOT NULL,
  `plan` text DEFAULT 'standard' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `starts_on` text,
  `ends_on` text,
  `note` text DEFAULT '' NOT NULL,
  `sort` integer DEFAULT 0 NOT NULL
);
