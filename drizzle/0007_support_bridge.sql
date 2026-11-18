CREATE TABLE `support_bridge_rate` (
	`client_key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
