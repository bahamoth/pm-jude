CREATE TABLE `mockup` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`doc_version` integer NOT NULL,
	`html` text NOT NULL,
	`summary` text,
	`convergence` text DEFAULT 'iterating' NOT NULL,
	`selected_theme` text,
	`theme_delegated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mockup_session_id_version_unique` ON `mockup` (`session_id`,`version`);--> statement-breakpoint
CREATE TABLE `mockup_annotation` (
	`id` text PRIMARY KEY NOT NULL,
	`mockup_id` text NOT NULL,
	`session_id` text NOT NULL,
	`text` text NOT NULL,
	`element_ref` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mockup_id`) REFERENCES `mockup`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mockup_annotation_session_idx` ON `mockup_annotation` (`session_id`);