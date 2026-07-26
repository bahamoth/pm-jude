import { describe, expect, it } from 'vitest';
import type { ReplyQuestion } from './types';
import { composeAnswerText, isComplete, type WizardAnswer } from './wizard';

const questions: ReplyQuestion[] = [
  {
    index: 1,
    question: '이 화면은 주로 누가 보게 되나요?',
    exampleOptions: ['영업팀 매니저', '영업사원 본인'],
    dontKnowLabel: '모르겠어요 — 개발팀이 정해 주세요',
  },
  {
    index: 2,
    question: '데이터는 어디에서 가져오면 되나요?',
    exampleOptions: ['CRM', '사내 DB'],
    dontKnowLabel: '모르겠어요 — 개발팀이 정해 주세요',
  },
];

describe('마법사 답변 조립', () => {
  it('객관식·모르겠다·직접 입력이 문항 번호에 대응된 자연문으로 조립된다', () => {
    const answers = new Map<number, WizardAnswer>([
      [1, { kind: 'option', value: '영업팀 매니저' }],
      [2, { kind: 'dontKnow' }],
    ]);

    expect(composeAnswerText(questions, answers)).toBe(
      '1. 이 화면은 주로 누가 보게 되나요? → 영업팀 매니저\n' +
        '2. 데이터는 어디에서 가져오면 되나요? → 모르겠어요 — 개발팀이 정해 주세요',
    );
  });

  it('직접 입력은 트림되고, 공백뿐이면 미완으로 취급된다', () => {
    const answers = new Map<number, WizardAnswer>([
      [1, { kind: 'free', value: '  파트너사 담당자요  ' }],
      [2, { kind: 'free', value: '   ' }],
    ]);

    expect(isComplete(questions, answers)).toBe(false);
    answers.set(2, { kind: 'option', value: 'CRM' });
    expect(isComplete(questions, answers)).toBe(true);
    expect(composeAnswerText(questions, answers)).toContain('→ 파트너사 담당자요');
  });

  it('답이 빠진 채 조립하면 실패한다 — 미완 제출 방어', () => {
    expect(() => composeAnswerText(questions, new Map())).toThrow();
  });
});
