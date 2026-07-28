/**
 * 첨부 추출의 경계 (F1-Attach, ADR-0011).
 *
 * 추출은 자료를 명확화 입력으로 쓸 수 있는 텍스트로 환원한다. 결과는 저장되어 라운드마다
 * 재사용되므로 **요청 맥락에 의존하지 않는다** — 무엇을 위해 읽는지에 따라 결과가 달라지면
 * 캐시가 성립하지 않는다.
 *
 * 실패는 예외가 아니라 결과다. 암호화 PDF·스캔본·손상 파일은 사유와 함께 돌아오고,
 * 세션을 멈출지는 호출자가 정한다 (P-U3 — 자료를 못 읽어도 요청은 진행된다).
 */
export interface ExtractionInput {
  bytes: Buffer;
  filename: string;
  mime: string;
}

export type ExtractionResult = { status: 'ok'; text: string } | { status: 'failed'; error: string };

export interface Extractor {
  /** `name@semver` — attachment.extractor_version에 그대로 남는다 (버전 축은 5축 유지). */
  readonly version: string;
  /** 이 추출기가 맡는 MIME 목록. */
  readonly mimes: readonly string[];
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}
