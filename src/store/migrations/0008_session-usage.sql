ALTER TABLE `session` ADD `total_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `total_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session` ADD `llm_call_count` integer DEFAULT 0 NOT NULL;