import type { PromptRegistry } from '../prompts/registry';
import {
  CLARIFICATION_V1,
  COMPLETENESS_V0,
  PROMOTION_V0,
  REQUIREMENTS_V0,
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
  const clarificationBody = registry.get(CLARIFICATION_V1).body;
  const completenessBody = registry.get(COMPLETENESS_V0).body;
  const promotionBody = registry.get(PROMOTION_V0).body;
  const requirementsBody = registry.get(REQUIREMENTS_V0).body;

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

  const unrefined = JSON.stringify({
    slots: [
      { slotKey: 'target-user', verdict: 'filled', rationale: '대상 사용자를 확답함' },
      { slotKey: 'purpose', verdict: 'unfilled', rationale: '해결하려는 문제가 아직 불명' },
      { slotKey: 'data-source', verdict: 'unfilled', rationale: '데이터 출처 답이 없음' },
    ],
    remainingAmbiguities: ['해결하려는 문제의 범위'],
    rubric: { score: 45, rationale: '핵심 슬롯이 비어 있음' },
  });

  const refined = JSON.stringify({
    slots: [
      { slotKey: 'target-user', verdict: 'filled', rationale: '대상 사용자를 확답함' },
      { slotKey: 'purpose', verdict: 'filled', rationale: '해결하려는 문제를 확답함' },
      {
        slotKey: 'data-source',
        verdict: 'promoted',
        rationale: '요청자가 「모르겠어요 — 개발팀이 정해 주세요」를 택함',
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

  return {
    run(request: BackendRequest): Promise<BackendResponse> {
      const usage = { inputTokens: 0, outputTokens: 0 };
      if (request.promptBody === clarificationBody) {
        return Promise.resolve({ outputText: clarification, usage });
      }
      if (request.promptBody === completenessBody) {
        const conversation = (request.input as { conversation?: unknown[] }).conversation ?? [];
        return Promise.resolve({
          outputText: conversation.length < 2 ? unrefined : refined,
          usage,
        });
      }
      if (request.promptBody === promotionBody) {
        return Promise.resolve({ outputText: promotion, usage });
      }
      if (request.promptBody === requirementsBody) {
        return Promise.resolve({ outputText: requirements, usage });
      }
      return Promise.reject(new Error('가짜 백엔드: 알 수 없는 프롬프트'));
    },
  };
}
