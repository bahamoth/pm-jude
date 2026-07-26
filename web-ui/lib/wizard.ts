import type { ReplyQuestion } from './types';

/** 마법사 한 문항의 답 — 객관식이 기본, 「모르겠다」·직접 입력은 상시 경로 (US-5). */
export type WizardAnswer =
  { kind: 'option'; value: string } | { kind: 'dontKnow' } | { kind: 'free'; value: string };

export function answerLabel(question: ReplyQuestion, answer: WizardAnswer): string {
  switch (answer.kind) {
    case 'option':
      return answer.value;
    case 'dontKnow':
      return question.dontKnowLabel;
    case 'free':
      return answer.value.trim();
  }
}

export function isAnswered(answer: WizardAnswer | undefined): answer is WizardAnswer {
  if (!answer) return false;
  if (answer.kind === 'free') return answer.value.trim().length > 0;
  return true;
}

export function isComplete(
  questions: ReplyQuestion[],
  answers: ReadonlyMap<number, WizardAnswer>,
): boolean {
  return questions.every((question) => isAnswered(answers.get(question.index)));
}

/**
 * 답변 묶음을 자연문 회신으로 조립한다 — 서버 계약(자유 텍스트 답변)은 그대로 두고
 * 질문 번호를 붙여 완결성 판정 LLM이 문항별로 대응시키게 한다.
 */
export function composeAnswerText(
  questions: ReplyQuestion[],
  answers: ReadonlyMap<number, WizardAnswer>,
): string {
  return questions
    .map((question) => {
      const answer = answers.get(question.index);
      if (!isAnswered(answer)) throw new Error(`문항 ${question.index}의 답이 비어 있다`);
      return `${question.index}. ${question.question} → ${answerLabel(question, answer)}`;
    })
    .join('\n');
}
