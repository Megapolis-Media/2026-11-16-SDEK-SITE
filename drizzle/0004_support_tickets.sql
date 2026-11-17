CREATE TABLE `support_delivery` (
	`ticket_id` text NOT NULL,
	`channel` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_ticket`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_delivery_ticket_channel` ON `support_delivery` (`ticket_id`,`channel`);--> statement-breakpoint
CREATE TABLE `support_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `support_ticket` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`email` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_ticket_id_unique` ON `support_ticket` (`id`);--> statement-breakpoint
CREATE INDEX `support_ticket_status_number` ON `support_ticket` (`status`,`number`);--> statement-breakpoint
CREATE INDEX `support_ticket_created_at` ON `support_ticket` (`created_at`);--> statement-breakpoint
CREATE INDEX `support_ticket_email_time` ON `support_ticket` (`email`,`created_at`);