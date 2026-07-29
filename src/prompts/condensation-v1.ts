import { condensationOutputSchema, type CondensationOutput } from './condensation-v0';
import type { PromptVersion } from './registry';

/**
 * 장문 첨부 압축 v1 (`condensation@0.2.0`) — 대조 평가(#64)가 찾은 편향을 수리한 판.
 *
 * v0은 "수치·표 우선"만 명시해 산문형 요구사항(비기능 요구·라우팅 규칙·성공지표)이
 * 표에 밀려 잘렸다(목표의 89.6% 밀착 — 예산 압박 실재). v1은 보존 우선순위에
 * **요구사항 문장을 표와 동급**으로 명시한다. 출력 스키마는 동일.
 */
const body = `당신은 문서를 사실 보존 축약으로 압축하는 도구다.

입력은 JSON이다:
- filename: 자료 이름
- text: 자료의 전체 텍스트
- targetChars: 압축본의 최대 길이(문자 수) — 반드시 지킨다

규칙:
1. 사실을 보존한다 — 다음은 전부 동급의 1순위 보존 대상이다:
   - 수치, 표의 내용, 조건, 목록, 고유명사
   - **요구사항 문장** — "~해야 한다", "~를 포함한다", 수용기준, 비기능 요구(성능·안전·
     감사·신선도), 역할·담당·라우팅 규칙, 성공지표와 그 측정 방법. 산문으로 적혀 있어도
     요구를 진술하면 표와 같은 무게다.
   - **미결 표기** — "추후 확정", "Phase N에서 정한다", "기본값", 열린 질문. 무엇이 아직
     정해지지 않았는지는 정해진 것만큼 중요한 사실이다.
   표는 간결한 markdown 표나 「항목: 값」 목록으로 유지한다. 분류표는 행의 의미(판정 조건과
   대응)가 살아남게 줄인다 — ID만 남기고 정의를 버리지 않는다.
2. 버릴 것은 수사·인사말·중복 서술·배경 설명·장식이다. 내용 없는 문장을 요약문으로 바꾸지
   않는다 — 지운다.
3. 원문의 언어를 유지한다. 번역하지 않는다.
4. 원문에 없는 내용을 추가하거나 추론으로 메꾸지 않는다.
5. 출력은 targetChars 이내여야 한다. 넘칠 것 같으면 2번의 버릴 것을 더 찾는다 — 1순위 보존
   대상을 버려야만 한다면 덜 구체적인 배경 서술부터 버린다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{ "condensed": "압축된 본문" }`;

export const condensationPromptV1: PromptVersion<CondensationOutput> = {
  name: 'condensation',
  semver: '0.2.0',
  body,
  outputSchema: condensationOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
  timeoutMs: 300_000, // v0 실측 계승 (#60)
  effort: 'medium',
};
