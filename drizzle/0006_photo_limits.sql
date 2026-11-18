CREATE TABLE `chat_photo_daily` (
	`author_key` text NOT NULL,
	`day` integer NOT NULL,
	`used` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_photo_daily_author_day` ON `chat_photo_daily` (`author_key`,`day`);--> statement-breakpoint
CREATE TABLE `local_upload_usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO chat_photo_daily (author_key, day, used)
SELECT COALESCE(author_key, client_key), CAST((created_at + 10800000) / 86400000 AS INTEGER), COUNT(*)
FROM chat_message WHERE image_key IS NOT NULL
GROUP BY COALESCE(author_key, client_key), CAST((created_at + 10800000) / 86400000 AS INTEGER);
--> statement-breakpoint
CREATE TRIGGER chat_photo_daily_guard BEFORE INSERT ON chat_message
WHEN NEW.image_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM chat_message WHERE id = NEW.id)
BEGIN
  SELECT CASE WHEN COALESCE((SELECT used FROM chat_photo_daily
    WHERE author_key = COALESCE(NEW.author_key, NEW.client_key)
    AND day = CAST((NEW.created_at + 10800000) / 86400000 AS INTEGER)), 0) >= 3
    THEN RAISE(ABORT, 'CDEK_PHOTO_DAILY_LIMIT') END;
END;
--> statement-breakpoint
CREATE TRIGGER chat_photo_daily_count AFTER INSERT ON chat_message
WHEN NEW.image_key IS NOT NULL
BEGIN
  INSERT INTO chat_photo_daily (author_key, day, used)
  VALUES (COALESCE(NEW.author_key, NEW.client_key), CAST((NEW.created_at + 10800000) / 86400000 AS INTEGER), 1)
  ON CONFLICT(author_key, day) DO UPDATE SET used = used + 1;
END;
