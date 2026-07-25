-- 원문 전사 상시 보존 (원칙 7): 발화 행 삭제와 원문 필드 수정을 DB 수준에서 차단한다.
-- 애플리케이션 API에 삭제 경로를 만들지 않는 것에 더해 우회 SQL도 트리거가 막는다 (원칙 2).
CREATE TRIGGER utterance_no_delete
BEFORE DELETE ON `utterance`
BEGIN
  SELECT RAISE(ABORT, 'utterance rows are immutable: original transcripts must be preserved (principle 7)');
END;
--> statement-breakpoint
CREATE TRIGGER utterance_no_original_rewrite
BEFORE UPDATE OF `original_text`, `original_language` ON `utterance`
BEGIN
  SELECT RAISE(ABORT, 'utterance original text is immutable (principle 7)');
END;
