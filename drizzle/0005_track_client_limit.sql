ALTER TABLE `track_request` ADD `client_key` text;--> statement-breakpoint
CREATE INDEX `track_client_time` ON `track_request` (`client_key`,`created_at`);