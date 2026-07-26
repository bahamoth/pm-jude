'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentView } from '@/components/document-view';
import { IntakeForm, type IntakeInput } from '@/components/intake-form';
import { QuestionWizard } from '@/components/question-wizard';
import { Transcript, type TranscriptEntry } from '@/components/transcript';
import { WaitingCard } from '@/components/waiting-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getSession, sendReply, startSession } from '@/lib/api';
import type { ReplyQuestion, RoundResult } from '@/lib/types';

const SESSION_KEY = 'pmjude.sessionId';

type Stage =
  | { kind: 'boot' }
  | { kind: 'intake' }
  | { kind: 'waiting'; phase: 'intake' | 'reply' }
  | { kind: 'wizard'; questions: ReplyQuestion[]; round: number }
  | { kind: 'document'; text: string }
  | { kind: 'closed'; terminalState: string | null }
  | { kind: 'error'; message: string };

/**
 * 인테이크 → 명확화 마법사 → 문서까지의 화면 상태 머신 (#22).
 * 전이는 이 컴포넌트가 결정하고, 서버 응답(status)이 유일한 근거다.
 */
export default function Home() {
  const [stage, setStage] = useState<Stage>({ kind: 'boot' });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  const pushTranscript = useCallback((entries: TranscriptEntry[]) => {
    setTranscript((previous) => [...previous, ...entries]);
  }, []);

  const boot = useCallback(async () => {
    const stored = typeof window === 'undefined' ? null : localStorage.getItem(SESSION_KEY);
    if (!stored) {
      setStage({ kind: 'intake' });
      return;
    }
    try {
      const detail = await getSession(stored);
      setSessionId(stored);
      setTranscript(
        detail.utterances.map((utterance) => ({
          who: utterance.authorType === 'requester' ? 'requester' : 'agent',
          text: utterance.originalText,
        })),
      );
      const { status, terminalState, roundCount } = detail.session;
      if (status === 'documented') {
        const documentText = detail.utterances.findLast((u) => u.authorType === 'agent');
        setStage({ kind: 'document', text: documentText?.originalText ?? '' });
      } else if (status === 'closed') {
        setStage({ kind: 'closed', terminalState });
      } else {
        setStage({
          kind: 'wizard',
          questions: detail.latestQuestions ?? [],
          round: Math.max(roundCount, 1),
        });
      }
    } catch {
      // 세션 조회 실패(삭제·이전 DB) — 새로 시작한다
      localStorage.removeItem(SESSION_KEY);
      setSessionId(null);
      setTranscript([]);
      setStage({ kind: 'intake' });
    }
  }, []);

  useEffect(() => {
    // 부팅 상태는 localStorage 판독이 필요해 마운트 후에만 결정할 수 있다(SSR 프리렌더와 분리)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void boot();
  }, [boot]);

  function routeRound(result: RoundResult, roundBefore: number) {
    pushTranscript(result.replies.map((reply) => ({ who: 'agent', text: reply.text })));
    if (result.status === 'documented') {
      setStage({ kind: 'document', text: result.replies.at(-1)?.text ?? '' });
    } else if (result.status === 'closed') {
      setStage({ kind: 'closed', terminalState: result.terminalState });
    } else {
      const questions = result.replies.findLast((reply) => reply.questions)?.questions ?? [];
      setStage({ kind: 'wizard', questions, round: roundBefore + 1 });
    }
  }

  async function handleIntake(input: IntakeInput) {
    setStage({ kind: 'waiting', phase: 'intake' });
    pushTranscript([{ who: 'requester', text: input.text }]);
    try {
      const result = await startSession(input);
      localStorage.setItem(SESSION_KEY, result.sessionId);
      setSessionId(result.sessionId);
      routeRound(result, 0);
    } catch (error) {
      setStage({ kind: 'error', message: error instanceof Error ? error.message : '요청 실패' });
    }
  }

  async function handleAnswer(text: string, round: number) {
    if (!sessionId) return;
    setStage({ kind: 'waiting', phase: 'reply' });
    pushTranscript([{ who: 'requester', text }]);
    try {
      routeRound(await sendReply(sessionId, text), round);
    } catch (error) {
      setStage({ kind: 'error', message: error instanceof Error ? error.message : '전송 실패' });
    }
  }

  function reset() {
    localStorage.removeItem(SESSION_KEY);
    setSessionId(null);
    setTranscript([]);
    setStage({ kind: 'intake' });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">
          pm-jude <span className="font-normal text-muted-foreground">· 요청 인테이크</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          {sessionId && (
            <Badge variant="outline" className="font-mono text-[11px]">
              요청 ID {sessionId.slice(0, 8)}
            </Badge>
          )}
          {sessionId && stage.kind !== 'waiting' && (
            <Button variant="ghost" size="sm" onClick={reset}>
              새 요청
            </Button>
          )}
        </div>
      </header>

      {stage.kind !== 'intake' && stage.kind !== 'boot' && <Transcript entries={transcript} />}

      {stage.kind === 'boot' && (
        <div className="grid gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {stage.kind === 'intake' && <IntakeForm onSubmit={(input) => void handleIntake(input)} />}

      {stage.kind === 'waiting' && <WaitingCard phase={stage.phase} />}

      {stage.kind === 'wizard' && (
        <QuestionWizard
          questions={stage.questions}
          round={stage.round}
          onSubmit={(text) => void handleAnswer(text, stage.round)}
        />
      )}

      {stage.kind === 'document' && (
        <div className="grid gap-4">
          <DocumentView text={stage.text} />
          <p className="text-center text-sm text-muted-foreground">
            문서가 전달됐어요. 원문 대화는 위 「지난 대화」에서 언제든 확인할 수 있습니다.
          </p>
        </div>
      )}

      {stage.kind === 'closed' && (
        <Alert>
          <AlertTitle>
            {stage.terminalState === 'on_hold_insufficient_info'
              ? '보류(정보 부족)로 정리됐어요'
              : '세션이 종결됐어요'}
          </AlertTitle>
          <AlertDescription>
            지금 답할 수 있는 정보가 부족해 요청을 잠시 보류했어요. 내용이 더 생기면 「새 요청」으로
            언제든 다시 시작할 수 있습니다.
          </AlertDescription>
        </Alert>
      )}

      {stage.kind === 'error' && (
        <Alert variant="destructive">
          <AlertTitle>진행에 문제가 생겼어요</AlertTitle>
          <AlertDescription className="grid gap-3">
            <span>{stage.message}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void boot()}>
                이어서 진행
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                새로 시작
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
