CREATE TABLE `site_studio` (
	`id` integer PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `track_request` (
	`id` text PRIMARY KEY NOT NULL,
	`author_key` text NOT NULL,
	`author_name` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`phase` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer
);
--> statement-breakpoint
CREATE INDEX `track_created` ON `track_request` (`created_at`);--> statement-breakpoint
CREATE INDEX `track_author_time` ON `track_request` (`author_key`,`created_at`);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `author_key` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `author_name` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `editorial` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `parent_id` text REFERENCES chat_message(id);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `thread_id` text REFERENCES chat_message(id);--> statement-breakpoint
ALTER TABLE `chat_message` ADD `image_key` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `image_type` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `image_digest` text;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `image_width` integer;--> statement-breakpoint
ALTER TABLE `chat_message` ADD `image_height` integer;--> statement-breakpoint
CREATE INDEX `chat_thread_time` ON `chat_message` (`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `chat_parent` ON `chat_message` (`parent_id`);--> statement-breakpoint
CREATE INDEX `chat_author_time` ON `chat_message` (`author_key`,`created_at`);