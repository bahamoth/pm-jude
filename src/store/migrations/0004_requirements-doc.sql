CREATE TABLE `requirements_doc` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`back_injected_from` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `requirements_doc_session_id_version_unique` ON `requirements_doc` (`session_id`,`version`);