ALTER TABLE `session` ADD `channel_thread_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `session_channel_thread_key_unique` ON `session` (`channel_thread_key`);