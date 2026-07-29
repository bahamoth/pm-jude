import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * 장문 첨부 압축 v0 (`condensation@0.1.0`) — 생성 호출 전용 파생물을 만든다 (#58, ADR-0014).
 *
 * 판정 호출(명확화·완결성·승격)은 항상 원문 전문을 받는다 — 압축본을 읽는 것은
 * requirements 같은 생성 호출뿐이다. 이 시점의 확정 사항은 슬롯에 이미 고정돼 있으므로
 * 압축의 임무는 요약이 아니라 **사실 보존 축약**이다: 수치·표·조건·목록을 남기고
 * 수사와 반복을 버린다.
 *
 * 요청 맥락에 의존하지 않는다 — 무엇을 위해 읽는지에 따라 결과가 달라지면 캐시가
 * 성립하지 않는다(ADR-0011의 추출 규율과 같은 지위).
 */
export const condensationOutputSchema = z.object({ condensed: z.string().min(1) }).strict();

export type CondensationOutput = z.infer<typeof condensationOutputSchema>;

const body = `당신은 문서를 사실 보존 축약으로 압축하는 도구다.

입력은 JSON이다:
- filename: 자료 이름
- text: 자료의 전체 텍스트
- targetChars: 압축본의 최대 길이(문자 수) — 반드시 지킨다

규칙:
1. 사실을 보존한다 — 수치, 표의 내용, 조건, 목록, 고유명사, 요구사항 문장은 남긴다.
   표는 간결한 markdown 표나 「항목: 값」 목록으로 유지한다.
2. 버릴 것은 수사·인사말·중복 서술·장식이다. 내용 없는 문장을 요약문으로 바꾸지 않는다 —
   지운다.
3. 원문의 언어를 유지한다. 번역하지 않는다.
4. 원문에 없는 내용을 추가하거나 추론으로 메꾸지 않는다.
5. 출력은 targetChars 이내여야 한다. 넘칠 것 같으면 덜 중요한 세부를 더 버린다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{ "condensed": "압축된 본문" }`;

export const condensationPromptV0: PromptVersion<CondensationOutput> = {
  name: 'condensation',
  semver: '0.1.0',
  body,
  outputSchema: condensationOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
  timeoutMs: 300_000, // 장문 입력을 읽는 호출 — 실측 117s로 기본 120s에 근접 (#60, 세션 49597175)
};
