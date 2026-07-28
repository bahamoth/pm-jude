import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * 이미지 첨부의 텍스트 환원 계약 (F1-Attach, ADR-0011 결정 3).
 *
 * 이미지가 모델에 원본으로 닿는 유일한 지점이다. 결과는 명확화 입력으로 쓰이는 텍스트이며,
 * 저장되어 라운드마다 재사용된다 — 그래서 **요청 맥락을 입력으로 받지 않는다**: 무엇을 위해
 * 읽는지에 따라 결과가 달라지면 캐시가 성립하지 않고, 재추출 결과가 세션마다 달라진다.
 * 자료 그 자체를 있는 그대로 옮기는 것이 이 호출의 임무다.
 *
 * 내부 처리라 Jude의 목소리를 쓰지 않는다 (ADR-0010).
 */
export const attachmentExtractionOutputSchema = z
  .object({
    /** 읽어낼 내용이 있었는가. false면 호출자가 추출 실패로 기록한다. */
    readable: z.boolean(),
    /** 자료의 서술 — 무엇이 담긴 화면·문서인지, 구성 요소와 관계. */
    description: z.string(),
    /** 이미지 안에서 읽어낸 문자열 그대로 (레이블·수치·제목 등). 없으면 빈 배열. */
    textContent: z.array(z.string()),
    /** readable=false일 때의 사유 — 요청자에게 무엇을 못 읽었는지 알리는 근거. */
    unreadableReason: z.string().optional(),
  })
  .strict();

export type AttachmentExtractionOutput = z.infer<typeof attachmentExtractionOutputSchema>;

const body = `당신은 요청에 첨부된 이미지 자료를 텍스트로 옮기는 처리기다.
이 결과는 요구사항 정제 파이프라인의 입력이 되고 저장되어 재사용된다.

입력은 이미지 원본과 다음 JSON이다:
- filename: 파일 이름
- mime: 이미지 형식

임무는 이미지를 **있는 그대로 텍스트로 옮기는 것**이다. 무엇을 위해 쓰이는지 추측하지 않는다 —
같은 이미지는 언제 읽어도 같은 결과여야 한다.

절차:
1. 무엇이 담긴 자료인지 서술한다 (description). 화면 캡처라면 어떤 화면이고 어떤 요소가
   어떤 배치로 있는지, 도표라면 무엇을 무엇과 비교하는지, 문서 사진이라면 어떤 문서인지.
2. 읽어낼 수 있는 문자를 그대로 옮긴다 (textContent). 메뉴 이름, 컬럼 제목, 수치, 버튼 레이블,
   본문 문장. 번역하지 않고 원문 그대로 적는다.
3. 읽어낼 내용이 없으면 readable=false로 두고 unreadableReason에 이유를 적는다 —
   해상도가 낮아 글자를 분간할 수 없음, 내용이 비어 있음, 형식을 알아볼 수 없음 등.

제약:
- 보이지 않는 것을 지어내지 않는다. 흐릿해서 확신할 수 없는 문자는 옮기지 않는다.
- 자료를 평가하거나 제안하지 않는다. 「이 화면은 개선이 필요해 보인다」 같은 문장을 쓰지 않는다.
- 요청자에게 말을 걸지 않는다. 이 출력은 요청자가 읽는 문장이 아니다.
- description은 자료의 언어와 무관하게 한국어로 쓰고, textContent는 원문 그대로 둔다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "readable": true,
  "description": "매출 관리 화면의 캡처. 상단에 기간 선택 필터, 아래에 팀별 매출 표가 있다",
  "textContent": ["기간", "팀명", "매출액", "영업1팀", "12,400,000"]
}`;

export const attachmentExtractionPromptV0: PromptVersion<AttachmentExtractionOutput> = {
  name: 'attachment-extraction',
  semver: '0.1.0',
  body,
  outputSchema: attachmentExtractionOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
