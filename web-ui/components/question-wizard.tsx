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
import { t, type Lang } from '@/lib/i18n';
import type { ReplyQuestion } from '@/lib/types';
import {
  answerLabel,
  composeAnswerText,
  isAnswered,
  isComplete,
  type WizardAnswer,
} from '@/lib/wizard';

interface Props {
  lang: Lang;
  questions: ReplyQuestion[];
  round: number;
  /** 왕복 예산 소진 직전 — 예고 없는 강제 종결을 막는다 (P-U5, G-2) */
  lastRound?: boolean;
  /** 키 입력 한 번 = Jude에게 소리 한 번 (docs/persona/jude.md) */
  onType?: () => void;
  onSubmit: (text: string) => void;
}

/**
 * 명확화 마법사 (US-3~5) — 한 화면에 한 질문, 객관식이 기본 동선.
 * 「모르겠다 / 개발팀이 정할 문제」와 직접 입력은 모든 문항의 상시 경로다 (US-10).
 * 질문 구조가 없으면(구버전 세션 재개) 자유 입력으로 강등한다.
 */
export function QuestionWizard({ lang, questions, round, lastRound, onType, onSubmit }: Props) {
  const [step, setStep] = useState(0); // questions.length == 확인 단계
  const [answers, setAnswers] = useState<ReadonlyMap<number, WizardAnswer>>(new Map());
  const [freeText, setFreeText] = useState('');

  if (questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t(lang, 'wizard.freeTitle')}</CardTitle>
          <CardDescription>{t(lang, 'wizard.freeLede')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={4}
            value={freeText}
            onChange={(event) => {
              setFreeText(event.target.value);
              onType?.();
            }}
            placeholder={t(lang, 'wizard.freeInputPlaceholder')}
          />
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={freeText.trim().length === 0}
            onClick={() => onSubmit(freeText.trim())}
          >
            {t(lang, 'wizard.send')}
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
          <span className="flex items-center gap-2">
            <Badge variant="secondary">{t(lang, 'wizard.roundBadge', { round })}</Badge>
            {lastRound && <Badge>{t(lang, 'wizard.lastRound')}</Badge>}
          </span>
          <span className="text-sm text-muted-foreground">
            {reviewing
              ? t(lang, 'wizard.reviewing')
              : t(lang, 'wizard.progress', { step: step + 1, total })}
          </span>
        </div>
        {lastRound && (
          <p className="text-xs text-muted-foreground">{t(lang, 'wizard.lastRoundNote')}</p>
        )}
        <Progress value={(Math.min(step, total) / total) * 100} />
        {current ? (
          <>
            <CardTitle className="text-lg leading-relaxed">{current.question}</CardTitle>
            <CardDescription>{t(lang, 'wizard.pickHint')}</CardDescription>
          </>
        ) : (
          <>
            <CardTitle className="text-lg">{t(lang, 'wizard.reviewTitle')}</CardTitle>
            <CardDescription>{t(lang, 'wizard.reviewHint')}</CardDescription>
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
              <span>{t(lang, 'wizard.freeChoice')}</span>
            </Label>
          </RadioGroup>
          {answers.get(current.index)?.kind === 'dontKnow' && (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {t(lang, 'wizard.dontKnowNote')}
            </p>
          )}
          {answers.get(current.index)?.kind === 'free' && (
            <Textarea
              className="mt-3"
              rows={3}
              autoFocus
              placeholder={t(lang, 'wizard.freePlaceholder')}
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
                  {isAnswered(answer)
                    ? answerLabel(question, answer)
                    : t(lang, 'wizard.unanswered')}
                  {answer?.kind === 'dontKnow' && (
                    <Badge variant="outline" className="ml-2">
                      {t(lang, 'wizard.forTeam')}
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
          {t(lang, 'common.prev')}
        </Button>
        {reviewing ? (
          <Button
            size="lg"
            disabled={!isComplete(questions, answers)}
            onClick={() => onSubmit(composeAnswerText(questions, answers))}
          >
            {t(lang, 'wizard.send')}
          </Button>
        ) : (
          <Button
            disabled={current !== undefined && !isAnswered(answers.get(current.index))}
            onClick={() => setStep((value) => value + 1)}
          >
            {t(lang, step === total - 1 ? 'wizard.reviewing' : 'common.next')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
