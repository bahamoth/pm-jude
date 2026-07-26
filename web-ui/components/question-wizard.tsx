'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { ReplyQuestion } from '@/lib/types';
import {
  answerLabel,
  composeAnswerText,
  isAnswered,
  isComplete,
  type WizardAnswer,
} from '@/lib/wizard';

interface Props {
  questions: ReplyQuestion[];
  round: number;
  onSubmit: (text: string) => void;
}

/**
 * 명확화 마법사 (US-3~5) — 한 화면에 한 질문, 객관식이 기본 동선.
 * 「모르겠다 / 개발팀이 정할 문제」와 직접 입력은 모든 문항의 상시 경로다 (US-10).
 * 질문 구조가 없으면(구버전 세션 재개) 자유 입력으로 강등한다.
 */
export function QuestionWizard({ questions, round, onSubmit }: Props) {
  const [step, setStep] = useState(0); // questions.length == 확인 단계
  const [answers, setAnswers] = useState<ReadonlyMap<number, WizardAnswer>>(new Map());
  const [freeText, setFreeText] = useState('');

  if (questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>이어서 답해 주세요</CardTitle>
          <CardDescription>진행 중인 요청에 보탤 내용을 자유롭게 적어 주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="추가로 알려줄 내용"
          />
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={freeText.trim().length === 0}
            onClick={() => onSubmit(freeText.trim())}
          >
            답변 보내기
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const total = questions.length;
  const reviewing = step === total;
  const current = reviewing ? undefined : questions[step];

  function setAnswer(index: number, answer: WizardAnswer) {
    setAnswers((previous) => new Map(previous).set(index, answer));
  }

  function choiceValue(question: ReplyQuestion): string | null {
    const answer = answers.get(question.index);
    if (!answer) return null;
    if (answer.kind === 'option') return `opt:${answer.value}`;
    return answer.kind;
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="secondary">명확화 {round}라운드</Badge>
          <span className="text-sm text-muted-foreground">
            {reviewing ? '답변 확인' : `질문 ${step + 1} / ${total}`}
          </span>
        </div>
        <Progress value={(Math.min(step, total) / total) * 100} />
        {current ? (
          <>
            <CardTitle className="text-lg leading-relaxed">{current.question}</CardTitle>
            <CardDescription>
              보기에서 고르거나, 직접 입력해 주세요. 답하기 어려우면 「모르겠어요」도 답입니다.
            </CardDescription>
          </>
        ) : (
          <>
            <CardTitle className="text-lg">이렇게 보낼게요</CardTitle>
            <CardDescription>
              답변을 확인하고 보내 주세요. 문항을 눌러 고칠 수 있어요.
            </CardDescription>
          </>
        )}
      </CardHeader>

      {current ? (
        <CardContent>
          <RadioGroup
            className="gap-2"
            value={choiceValue(current)}
            onValueChange={(value) => {
              const selected = String(value);
              if (selected === 'dontKnow') setAnswer(current.index, { kind: 'dontKnow' });
              else if (selected === 'free') {
                const existing = answers.get(current.index);
                setAnswer(current.index, {
                  kind: 'free',
                  value: existing?.kind === 'free' ? existing.value : '',
                });
              } else if (selected.startsWith('opt:')) {
                setAnswer(current.index, { kind: 'option', value: selected.slice(4) });
              }
            }}
          >
            {current.exampleOptions.map((option) => (
              <Label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 font-normal transition-colors hover:bg-accent has-data-checked:border-primary has-data-checked:bg-primary/5"
              >
                <RadioGroupItem value={`opt:${option}`} />
                <span>{option}</span>
              </Label>
            ))}
            <Label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3.5 font-normal text-muted-foreground transition-colors hover:bg-accent has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-checked:text-foreground">
              <RadioGroupItem value="dontKnow" />
              <span>{current.dontKnowLabel}</span>
            </Label>
            <Label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3.5 font-normal text-muted-foreground transition-colors hover:bg-accent has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-checked:text-foreground">
              <RadioGroupItem value="free" />
              <span>직접 입력할게요</span>
            </Label>
          </RadioGroup>
          {answers.get(current.index)?.kind === 'free' && (
            <Textarea
              className="mt-3"
              rows={3}
              autoFocus
              placeholder="답변을 입력해 주세요"
              value={(() => {
                const answer = answers.get(current.index);
                return answer?.kind === 'free' ? answer.value : '';
              })()}
              onChange={(event) =>
                setAnswer(current.index, { kind: 'free', value: event.target.value })
              }
            />
          )}
        </CardContent>
      ) : (
        <CardContent className="grid gap-1">
          {questions.map((question, index) => {
            const answer = answers.get(question.index);
            return (
              <button
                key={question.index}
                type="button"
                onClick={() => setStep(index)}
                className="rounded-lg p-3 text-left transition-colors hover:bg-accent"
              >
                <p className="text-sm text-muted-foreground">
                  {question.index}. {question.question}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {isAnswered(answer) ? answerLabel(question, answer) : '— 미응답'}
                  {answer?.kind === 'dontKnow' && (
                    <Badge variant="outline" className="ml-2">
                      개발팀 확인
                    </Badge>
                  )}
                </p>
                {index < questions.length - 1 && <Separator className="mt-3" />}
              </button>
            );
          })}
        </CardContent>
      )}

      <CardFooter className="flex justify-between gap-3">
        <Button
          variant="ghost"
          disabled={step === 0}
          onClick={() => setStep((value) => Math.max(0, value - 1))}
        >
          이전
        </Button>
        {reviewing ? (
          <Button
            size="lg"
            disabled={!isComplete(questions, answers)}
            onClick={() => onSubmit(composeAnswerText(questions, answers))}
          >
            답변 보내기
          </Button>
        ) : (
          <Button
            disabled={current !== undefined && !isAnswered(answers.get(current.index))}
            onClick={() => setStep((value) => value + 1)}
          >
            {step === total - 1 ? '답변 확인' : '다음'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
