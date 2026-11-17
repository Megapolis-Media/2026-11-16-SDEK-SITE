CREATE TABLE `studio_login_attempt` (
	`client_key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_login_attempt_expiry` ON `studio_login_attempt` (`expires_at`);--> statement-breakpoint
CREATE TABLE `studio_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`password_version` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `studio_session_expiry` ON `studio_session` (`expires_at`);