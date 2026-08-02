CREATE TABLE `diagram_state` (
	`session_id` text NOT NULL,
	`diagram_id` text NOT NULL,
	`confirmed_by_requester` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`session_id`, `diagram_id`),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action
);
