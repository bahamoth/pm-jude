import type { PromptRegistry } from '../prompts/registry';
import {
  ATTACHMENT_EXTRACTION_V0,
  BACK_INJECTION_V0,
  CLARIFICATION_V2,
  COMPLETENESS_V1,
  MOCKUP_V0,
  PROMOTION_V0,
  REQUIREMENTS_V1,
  UI_CLASSIFICATION_V0,
} from '../prompts/catalog';
import type { BackendRequest, BackendResponse, LlmBackend } from './backend';

/**
 * 데모·UI 검증 전용 가짜 백엔드 (PMJUDE_FAKE_BACKEND=1) — LLM 자격 증명 없이
 * 파이프라인 전체를 결정론적으로 돌린다. 프롬프트 본문으로 호출 종류를 판별하고
 * 스키마 유효한 고정 출력을 되돌린다. 운영 경로에서는 절대 쓰지 않는다.
 *
 * 시나리오: 1라운드 답변까지는 미정제(다음 라운드 유도), 2번째 답변부터 정제 완료.
 */
export function createFakeBackend(registry: PromptRegistry): LlmBackend {
  const clarificationBody = registry.get(CLARIFICATION_V2).body;
  const completenessBody = registry.get(COMPLETENESS_V1).body;
  const promotionBody = registry.get(PROMOTION_V0).body;
  const requirementsBody = registry.get(REQUIREMENTS_V1).body;
  const extractionBody = registry.get(ATTACHMENT_EXTRACTION_V0).body;
  const uiClassificationBody = registry.get(UI_CLASSIFICATION_V0).body;
  const mockupBody = registry.get(MOCKUP_V0).body;
  const backInjectionBody = registry.get(BACK_INJECTION_V0).body;

  const clarification = JSON.stringify({
    interpretations: ['관리자용 실적 대시보드', '영업사원 개인 실적 화면'],
    questions: [
      {
        question: '이 화면을 주로 보실 분을 알려주시면 범위를 좀 좁혀볼게요.',
        target: { type: 'slot', slotKey: 'target-user' },
        exampleOptions: ['영업팀 매니저', '영업사원 본인', '경영진'],
        dontKnowPath: { label: '아직 모르겠어요 — 제가 개발팀 몫으로 남겨둘게요' },
      },
      {
        question: '어떤 문제를 해결하고 싶으신 건지 알려주시겠어요?',
        target: { type: 'slot', slotKey: 'purpose' },
        exampleOptions: ['수작업 집계 제거', '실적 공유 자동화', '추세 파악'],
        dontKnowPath: { label: '아직 모르겠어요 — 제가 개발팀 몫으로 남겨둘게요' },
      },
      {
        question: '데이터는 어디에서 가져오면 될까요?',
        target: { type: 'slot', slotKey: 'data-source' },
        exampleOptions: ['CRM', '사내 DB', '스프레드시트'],
        dontKnowPath: { label: '아직 모르겠어요 — 제가 개발팀 몫으로 남겨둘게요' },
      },
    ],
  });

  const fromConversation = { source: 'conversation' as const };

  const unrefined = JSON.stringify({
    slots: [
      {
        slotKey: 'target-user',
        verdict: 'filled',
        rationale: '대상 사용자를 확답함',
        evidence: fromConversation,
      },
      {
        slotKey: 'purpose',
        verdict: 'unfilled',
        rationale: '해결하려는 문제가 아직 불명',
        evidence: fromConversation,
      },
      {
        slotKey: 'data-source',
        verdict: 'unfilled',
        rationale: '데이터 출처 답이 없음',
        evidence: fromConversation,
      },
    ],
    remainingAmbiguities: ['해결하려는 문제의 범위'],
    rubric: { score: 45, rationale: '핵심 슬롯이 비어 있음' },
  });

  const refined = JSON.stringify({
    slots: [
      {
        slotKey: 'target-user',
        verdict: 'filled',
        rationale: '대상 사용자를 확답함',
        evidence: fromConversation,
      },
      {
        slotKey: 'purpose',
        verdict: 'filled',
        rationale: '해결하려는 문제를 확답함',
        evidence: fromConversation,
      },
      {
        slotKey: 'data-source',
        verdict: 'promoted',
        rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함',
        evidence: fromConversation,
      },
    ],
    remainingAmbiguities: [],
    rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
  });

  /** 자료가 붙은 세션의 첫 판정 — 첫 슬롯을 첨부에서 읽은 것으로 돌려준다 (출처 표시 데모). */
  const refinedWithAttachment = JSON.stringify({
    slots: [
      {
        slotKey: 'target-user',
        verdict: 'filled',
        rationale: '올려주신 자료에 대상 사용자가 적혀 있음',
        evidence: { source: 'attachment', attachmentRef: 'A1' },
      },
      {
        slotKey: 'purpose',
        verdict: 'filled',
        rationale: '해결하려는 문제를 확답함',
        evidence: fromConversation,
      },
      {
        slotKey: 'data-source',
        verdict: 'promoted',
        rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함',
        evidence: fromConversation,
      },
    ],
    remainingAmbiguities: [],
    rubric: { score: 90, rationale: '핵심 슬롯 모두 해소' },
  });

  /** 상한 도달 데모(maxRounds를 낮춘 경우) — 남은 슬롯을 담당자 몫으로 넘겨 조건부 문서로 간다. */
  const promotion = JSON.stringify({
    decisions: [
      {
        slotKey: 'purpose',
        promotable: true,
        rationale: '대화에 문제 상황이 드러나 담당자가 범위를 정할 수 있다',
        openIssueQuestion: '대시보드가 답해야 할 핵심 질문을 무엇으로 확정할 것인가',
      },
      {
        slotKey: 'data-source',
        promotable: true,
        rationale: '데이터의 진실 원천은 담당자가 정하는 항목이다',
        openIssueQuestion: '매출 집계의 진실 원천으로 어느 저장소를 쓸 것인가',
      },
    ],
  });

  const requirements = JSON.stringify({
    problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    users: ['영업팀 매니저'],
    scope: { inScope: ['월별 매출 추이 조회', '팀별 실적 비교'], outOfScope: ['실시간 알림'] },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
            gwt: {
              given: '매출 데이터가 존재할 때',
              when: '기간을 선택하면',
              then: '월별 합계가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: [],
    openIssues: [],
  });

  const extraction = JSON.stringify({
    readable: true,
    description: '매출 관리 화면의 캡처. 상단에 기간 선택 필터, 아래에 팀별 매출 표가 있다',
    textContent: ['기간', '팀명', '매출액', '영업1팀', '12,400,000'],
  });

  /** 대시보드 데모는 UI 요청이다 — 목업 반복(F4, #54)까지 시연이 관통된다. */
  const uiClassification = JSON.stringify({
    isUiRequest: true,
    rationale: '월별 매출 추이를 조회하는 대시보드 화면이 신설된다',
  });

  /** 구조 층 목업 — --pj-* 토큰만 소비한다. 재생성 호출이면 반영 표식을 남긴다. */
  const mockupHtml = (revised: boolean) =>
    JSON.stringify({
      html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>영업 실적 대시보드</title>
<style>body{margin:0;font-family:var(--pj-font);background:var(--pj-bg);color:var(--pj-fg)}
main{max-width:720px;margin:24px auto;padding:0 16px}
.card{background:var(--pj-surface);border:1px solid var(--pj-border);border-radius:var(--pj-radius);padding:16px;margin-bottom:12px}
button{background:var(--pj-accent);color:var(--pj-accent-fg);border:0;border-radius:var(--pj-radius);padding:8px 14px}
.muted{color:var(--pj-muted)}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid var(--pj-border);padding:8px;text-align:left}</style></head>
<body><main><h1>영업 실적 대시보드${revised ? ' <small class="muted">(코멘트 반영판)</small>' : ''}</h1>
<div class="card"><button id="p30">최근 30일</button> <button id="p90">최근 90일</button>
<table><thead><tr><th>월</th><th>매출</th></tr></thead><tbody id="rows"></tbody></table>
<p id="empty" class="muted" hidden>선택한 기간에 데이터가 없어요.</p></div>
<script>const d={p30:[['6월','1,240만']],p90:[['4월','980만'],['5월','1,100만'],['6월','1,240만']]};
function render(k){const r=document.getElementById('rows');r.innerHTML='';
(d[k]||[]).forEach(([m,v])=>{const tr=document.createElement('tr');tr.innerHTML='<td>'+m+'</td><td>'+v+'</td>';r.appendChild(tr)});
document.getElementById('empty').hidden=(d[k]||[]).length>0}
document.getElementById('p30').onclick=()=>render('p30');document.getElementById('p90').onclick=()=>render('p90');render('p30')</script>
</main></body></html>`,
      summary: revised
        ? '남겨주신 코멘트를 반영해 화면을 고친 판이에요.'
        : '월별 매출 추이와 기간 필터를 담은 첫 화면이에요.',
    });

  /** 역주입 — 목업에서 확정된 사항이 문장으로 흡수된 다음 버전 문서. */
  const backInjected = JSON.stringify({
    problem: '영업 실적을 정리해 볼 수단이 없어 매니저가 수작업으로 집계한다',
    users: ['영업팀 매니저'],
    scope: { inScope: ['월별 매출 추이 조회', '팀별 실적 비교'], outOfScope: ['실시간 알림'] },
    stories: [
      {
        story: '영업팀 매니저로서, 월별 매출 추이를 확인하고 싶다',
        acceptanceCriteria: [
          {
            ears: 'When 매니저가 기간을 선택하면, the system shall 월별 매출 합계를 표시한다',
            gwt: {
              given: '매출 데이터가 존재할 때',
              when: '기간을 선택하면',
              then: '월별 합계가 표시된다',
            },
          },
          {
            ears: 'When 선택한 기간에 데이터가 없으면, the system shall 빈 상태 안내 문구를 표시한다',
            gwt: {
              given: '목업 반복에서 확정 — 빈 상태 문구 표시',
              when: '데이터 없는 기간을 선택하면',
              then: '안내 문구가 표시된다',
            },
          },
        ],
      },
    ],
    dataSources: [],
    openIssues: [],
  });

  return {
    run(request: BackendRequest): Promise<BackendResponse> {
      const usage = { inputTokens: 0, outputTokens: 0 };
      if (request.promptBody === clarificationBody) {
        return Promise.resolve({ outputText: clarification, usage });
      }
      if (request.promptBody === completenessBody) {
        const input = request.input as { conversation?: unknown[]; attachments?: unknown[] };
        const conversation = input.conversation ?? [];
        if (conversation.length < 2) return Promise.resolve({ outputText: unrefined, usage });
        return Promise.resolve({
          outputText: input.attachments?.length ? refinedWithAttachment : refined,
          usage,
        });
      }
      if (request.promptBody === promotionBody) {
        return Promise.resolve({ outputText: promotion, usage });
      }
      if (request.promptBody === requirementsBody) {
        return Promise.resolve({ outputText: requirements, usage });
      }
      if (request.promptBody === uiClassificationBody) {
        return Promise.resolve({ outputText: uiClassification, usage });
      }
      if (request.promptBody === mockupBody) {
        const input = request.input as { previousHtml?: string };
        return Promise.resolve({
          outputText: mockupHtml(input.previousHtml !== undefined),
          usage,
        });
      }
      if (request.promptBody === backInjectionBody) {
        return Promise.resolve({ outputText: backInjected, usage });
      }
      if (request.promptBody === extractionBody) {
        // 이미지가 실려 오지 않았다면 배선이 끊긴 것이다 — 조용히 그럴듯한 서술을 지어내면
        // 데모가 통과하면서 실제로는 아무것도 읽지 않는 상태를 가린다
        return request.images?.length
          ? Promise.resolve({ outputText: extraction, usage })
          : Promise.reject(new Error('가짜 백엔드: 추출 호출에 이미지가 실려 오지 않았다'));
      }
      return Promise.reject(new Error('가짜 백엔드: 알 수 없는 프롬프트'));
    },
  };
}
