CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_client_time` ON `chat_message` (`client_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_created_at` ON `chat_message` (`created_at`);