CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`utterance_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_ref` text NOT NULL,
	`extracted_text` text,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`extraction_error` text,
	`extractor_version` text,
	`created_at` text NOT NULL,
	`extracted_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`utterance_id`) REFERENCES `utterance`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_session_idx` ON `attachment` (`session_id`);--> statement-breakpoint
CREATE TABLE `staged_upload` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_ref` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `slot_state` ADD `evidence_attachment_id` text REFERENCES attachment(id);--> statement-breakpoint
-- 첨부 원본 보존 (ADR-0011): 요청자가 준 것은 지우지도 바꾸지도 않는다. 원문 전사(0001)와 같은
-- 규율이되 범위가 다르다 — 추출 결과 필드는 재추출로 갱신되어야 하므로 트리거가 막지 않는다.
CREATE TRIGGER attachment_no_delete
BEFORE DELETE ON `attachment`
BEGIN
  SELECT RAISE(ABORT, 'attachment rows are immutable: uploaded originals must be preserved (ADR-0011)');
END;
--> statement-breakpoint
CREATE TRIGGER attachment_no_original_rewrite
BEFORE UPDATE OF `session_id`, `utterance_id`, `filename`, `mime`, `bytes`, `sha256`, `storage_ref` ON `attachment`
BEGIN
  SELECT RAISE(ABORT, 'attachment original is immutable: only extraction fields may change (ADR-0011)');
END;