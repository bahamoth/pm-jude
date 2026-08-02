import { z } from 'zod';
import type { PromptVersion } from './registry';

/**
 * requirements 문서 생성 프롬프트 v0의 구조화 출력 계약 (F3).
 * 문제/사용자/스코프/스토리·수용기준(EARS + Given-When-Then)/데이터 소스/오픈이슈 구조이며,
 * strict 스키마라 아키텍처·스택 같은 「어떻게」 필드는 통과하지 못한다 (원칙 3).
 */
export const requirementsOutputSchema = z
  .object({
    problem: z.string().min(1),
    users: z.array(z.string().min(1)).min(1),
    scope: z
      .object({
        inScope: z.array(z.string().min(1)).min(1),
        outOfScope: z.array(z.string().min(1)),
      })
      .strict(),
    stories: z
      .array(
        z
          .object({
            story: z.string().min(1),
            acceptanceCriteria: z
              .array(
                z
                  .object({
                    /** EARS 구문 수용기준. */
                    ears: z.string().min(1),
                    gwt: z
                      .object({
                        given: z.string().min(1),
                        when: z.string().min(1),
                        then: z.string().min(1),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
    dataSources: z.array(z.string().min(1)),
    /** 오픈이슈 — 승격 슬롯은 조립 단계(코드)에서 반드시 합류한다. */
    openIssues: z
      .array(
        z
          .object({
            slotKey: z.string().min(1),
            question: z.string().min(1),
            assignee: z.string().nullable(),
          })
          .strict(),
      )
      .default([]),
    /**
     * 규범 다이어그램 (v2.0, ADR-0018 — #70) — 시각 구조가 본질인 확정 사항의 표기.
     * 텍스트 표기(mermaid)만 규범 지위를 가지며, 요청자의 다이어그램 단위 확인 전에는
     * 「확인 전 — 참고용」으로 표시된다. 구 버전 프롬프트 출력은 이 필드가 없다 — default가 받는다.
     */
    diagrams: z
      .array(
        z
          .object({
            /** 문서 내 참조·확인의 좌표 — 짧은 영문 슬러그 (예: "order-flow"). */
            id: z.string().min(1),
            title: z.string().min(1),
            kind: z.enum(['flow', 'state', 'hierarchy', 'screen']),
            /** mermaid 텍스트 표기 — diff 가능해야 규범이 된다 (ADR-0018 결정 2). */
            mermaid: z.string().min(1),
            /** 출처 — 첨부 유래면 그 ref(A1…), 대화 유래면 null (F2c 출처 규율과 대칭). */
            sourceAttachmentRef: z.string().nullable(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type RequirementsOutput = z.infer<typeof requirementsOutputSchema>;

export interface PromotedSlot {
  slotKey: string;
  openIssueAssignee: string | null;
  question: string;
}

export interface TranscriptEntry {
  seq: number;
  authorType: 'requester' | 'agent' | 'approver';
  originalText: string;
  originalLanguage: string;
}

export interface RequirementsDocument {
  content: RequirementsOutput;
  /** 원문 전사 첨부 — 옵션이 아니라 상시 (원칙 7). */
  originalTranscript: TranscriptEntry[];
}

/**
 * LLM 출력을 최종 requirements 문서로 조립한다 — 코드 강제 구간 (원칙 2).
 * 승격 슬롯의 오픈이슈 합류와 원문 전사 첨부는 프롬프트에 부탁하지 않고 여기서 보장한다.
 */
export function assembleRequirementsDocument(input: {
  output: RequirementsOutput;
  promotedSlots: PromotedSlot[];
  utterances: TranscriptEntry[];
}): RequirementsDocument {
  const openIssues = [...input.output.openIssues];
  for (const slot of input.promotedSlots) {
    const existing = openIssues.find((issue) => issue.slotKey === slot.slotKey);
    if (existing) {
      existing.assignee = slot.openIssueAssignee;
    } else {
      openIssues.push({
        slotKey: slot.slotKey,
        question: slot.question,
        assignee: slot.openIssueAssignee,
      });
    }
  }
  return {
    content: { ...input.output, openIssues },
    originalTranscript: input.utterances,
  };
}

const body = `당신은 비개발자 스테이크홀더의 요청을 개발 가능한 요구사항으로 정제하는 PM 인테이크 에이전트다.
지금 단계의 임무는 명확화가 끝난 요청을 requirements 문서로 변환하는 것이다.

입력은 JSON이다:
- request: 요청 원문 (요청자 언어 그대로)
- teamLanguage: 팀 표준 문서 언어 (BCP 47) — 문서는 반드시 이 언어로 쓴다
- clarifications: 명확화 질문·답변 목록 [{ question, answer, slotKey? }]
- filledSlots: 확정된 슬롯 값 [{ key, label, value }]
- promotedSlots: 요청자가 답할 수 없어 승격된 슬롯 [{ key, question }]

절차:
1. problem — 요청이 해결하려는 문제를 요청자의 상황 그대로 서술한다. 해결책을 앞세우지 않는다.
2. users — 실사용자를 구체적 역할로 적는다. 요청자와 실사용자가 다르면 실사용자를 적는다.
3. scope — 확정 답변에서 in/out을 가른다. 답변에 근거 없는 항목을 늘리지 않는다.
4. stories — 유저스토리마다 수용기준을 EARS 구문(When/While/Where ... the system shall ...)과
   Given-When-Then 두 형태로 모두 쓴다. 검증 불가능한 문장("적당히", "빨리", "개선")을 쓰지 않는다.
5. dataSources — 답변에서 확인된 데이터 출처만 적는다. 불명이면 비워 두고 오픈이슈로 남긴다.
6. openIssues — promotedSlots의 각 항목을 그대로 옮긴다. 임의로 해소하거나 누락하지 않는다.

제약:
- 아키텍처·기술 스택·코드·구현 방식을 쓰지 않는다. 「어떻게」는 개발팀의 몫이다.
- 문서에 없는 사실을 지어내지 않는다. 근거는 clarifications와 filledSlots뿐이다.

출력은 아래 형태의 JSON 하나만. 다른 텍스트를 덧붙이지 않는다:
{
  "problem": "...",
  "users": ["..."],
  "scope": { "inScope": ["..."], "outOfScope": ["..."] },
  "stories": [
    {
      "story": "...",
      "acceptanceCriteria": [
        { "ears": "When ..., the system shall ...", "gwt": { "given": "...", "when": "...", "then": "..." } }
      ]
    }
  ],
  "dataSources": ["..."],
  "openIssues": [{ "slotKey": "...", "question": "...", "assignee": null }]
}`;

export const requirementsPromptV0: PromptVersion<RequirementsOutput> = {
  name: 'requirements',
  semver: '0.1.0',
  body,
  outputSchema: requirementsOutputSchema,
  regressionPassed: false, // F12 — 골든셋 회귀 통과 전까지 false
};
