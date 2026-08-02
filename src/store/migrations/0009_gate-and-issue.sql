CREATE TABLE `gate_item` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`doc_version` integer NOT NULL,
	`is_conditional` integer DEFAULT false NOT NULL,
	`decision` text,
	`reason_tag` text,
	`note` text,
	`decided_by` text,
	`submitted_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gate_item_session_id_doc_version_unique` ON `gate_item` (`session_id`,`doc_version`);--> statement-breakpoint
CREATE TABLE `linear_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`gate_item_id` text NOT NULL,
	`linear_issue_id` text NOT NULL,
	`identifier` text NOT NULL,
	`url` text NOT NULL,
	`provenance_key` text NOT NULL,
	`connector` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`gate_item_id`) REFERENCES `gate_item`(`id`) ON UPDATE no action ON DELETE no action
);
