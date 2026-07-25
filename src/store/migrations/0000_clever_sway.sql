CREATE TABLE `prompt_version` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`semver` text NOT NULL,
	`body_ref` text NOT NULL,
	`regression_passed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requester` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`preferred_language` text NOT NULL,
	`timezone` text NOT NULL,
	`channel_identities` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`terminal_state` text,
	`origin_channel` text NOT NULL,
	`is_ui_request` integer,
	`round_count` integer DEFAULT 0 NOT NULL,
	`prompt_version_id` text NOT NULL,
	`model_version` text NOT NULL,
	`threshold_version_id` text NOT NULL,
	`slot_schema_version_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`threshold_version_id`) REFERENCES `threshold_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slot_schema_version_id`) REFERENCES `slot_schema_version`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session_requester` (
	`session_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`role` text NOT NULL,
	`subscribed` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`session_id`, `requester_id`),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `requester`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `signal` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`prompt_version_id` text NOT NULL,
	`model_version` text NOT NULL,
	`threshold_version_id` text NOT NULL,
	`slot_schema_version_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_version_id`) REFERENCES `prompt_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`threshold_version_id`) REFERENCES `threshold_version`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`slot_schema_version_id`) REFERENCES `slot_schema_version`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `signal_session_idx` ON `signal` (`session_id`);--> statement-breakpoint
CREATE TABLE `slot_schema_version` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`semver` text NOT NULL,
	`body_ref` text NOT NULL,
	`regression_passed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`slots` text NOT NULL,
	`derived_from` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slot_state` (
	`session_id` text NOT NULL,
	`slot_key` text NOT NULL,
	`state` text NOT NULL,
	`value` text,
	`confirmed_by_requester` integer DEFAULT false NOT NULL,
	`evidence_utterance_id` text,
	`open_issue_assignee` text,
	PRIMARY KEY(`session_id`, `slot_key`),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_utterance_id`) REFERENCES `utterance`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `threshold_version` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`semver` text NOT NULL,
	`body_ref` text NOT NULL,
	`regression_passed` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `utterance` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`channel` text NOT NULL,
	`original_text` text NOT NULL,
	`original_language` text NOT NULL,
	`normalized_text` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `utterance_session_id_seq_unique` ON `utterance` (`session_id`,`seq`);