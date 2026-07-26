'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AckCard } from '@/components/ack-card';
import { DocumentView } from '@/components/document-view';
import { HoldCard } from '@/components/hold-card';
import { JourneyStepper } from '@/components/journey-stepper';
import { QuestionWizard } from '@/components/question-wizard';
import { RoundContext } from '@/components/round-context';
import { SlotReview } from '@/components/slot-review';
import { Transcript } from '@/components/transcript';
import { WaitingCard } from '@/components/waiting-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { confirmSlotOk, correctSlot, getSession, retryRound, sendReply } from '@/lib/api';
import { rememberSession } from '@/lib/local-sessions';
import { isLastRound, journeyStep } from '@/lib/stage';
import type { SessionDetail } from '@/lib/types';
import { watchProcessing } from '@/lib/watch-processing';

/**
 * 세션 화면 (딥링크 /s/:id — P-U2 상시 재개). 서버 status·processing이 화면의 유일한 근거다.
 * 모든 LLM 라운드는 202로 접수되고 watchProcessing(SSE, 수명 규칙 #31)으로 완료를 기다린다.
 */
export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const watchingRef = useRef(false);

  const refetch = useCallback(async () => {
    try {
      const next = await getSession(sessionId);
      setDetail(next);
      return next;
    } catch {
      setNotFound(true);
      return null;
    }
  }, [sessionId]);

  /** 진행 중인 처리를 끝까지 지켜보고 화면을 갱신한다 — 중복 감시는 1개로 합쳐진다. */
  const watchThenRefetch = useCallback(async () => {
    if (watchingRef.current) return;
    watchingRef.current = true;
    try {
      await watchProcessing(sessionId);
      await refetch();
    } finally {
      watchingRef.current = false;
    }
  }, [refetch, sessionId]);

  useEffect(() => {
    rememberSession(sessionId);
    // 부팅 조회는 마운트 후에만 가능(딥링크 진입) — 상태 반영은 응답 후 비동기
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch().then((next) => {
      // 다른 탭·백그라운드에서 돌던 처리도 이어서 지켜본다 (P-U2)
      if (next?.processing) void watchThenRefetch();
    });
  }, [refetch, sessionId, watchThenRefetch]);

  /** 202 접수 → 처리 감시 → 재조회. LLM이 도는 모든 행동의 공통 경로. */
  async function act(kick: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await kick();
      await watchThenRefetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Shell sessionId={sessionId}>
        <Alert variant="destructive">
          <AlertTitle>요청을 찾을 수 없어요</AlertTitle>
          <AlertDescription>
            링크가 잘못됐거나 서버 저장소가 바뀌었어요.{' '}
            <Link className="underline" href="/">
              홈으로
            </Link>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }
  if (!detail) {
    return (
      <Shell sessionId={sessionId}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    );
  }

  const { session, latestQuestions, roundBudget, slotStates, utterances, processing } = detail;
  const onHold =
    session.status === 'closed' && session.terminalState === 'on_hold_insufficient_info';
  // 실패 판정은 상태로 유도한다: intake인데 처리 중이 아니면 첫 라운드가 죽은 것
  const roundFailed = session.status === 'intake' && !processing && !busy;
  const documentText = utterances.findLast((u) => u.authorType === 'agent')?.originalText ?? '';

  return (
    <Shell sessionId={sessionId}>
      <JourneyStepper current={journeyStep(session.status)} note={onHold ? '보류' : undefined} />

      <Transcript
        entries={utterances.map((u) => ({
          who: u.authorType === 'requester' ? 'requester' : 'agent',
          text: u.originalText,
        }))}
      />

      {session.status === 'intake' ? (
        <AckCard
          sessionId={sessionId}
          failed={roundFailed}
          onRetry={() => {
            void retryRound(sessionId)
              .then(() => watchThenRefetch())
              .catch((e) => setError(e instanceof Error ? e.message : '재시도 실패'));
          }}
        />
      ) : busy || processing ? (
        <WaitingCard phase="reply" />
      ) : session.status === 'clarifying' ? (
        <div className="grid gap-4">
          {session.roundCount > 1 && <RoundContext slots={slotStates} />}
          <QuestionWizard
            key={`${session.roundCount}-${latestQuestions?.[0]?.question ?? ''}`}
            questions={latestQuestions ?? []}
            round={Math.max(session.roundCount, 1)}
            lastRound={isLastRound(session.roundCount, roundBudget)}
            onSubmit={(text) => void act(() => sendReply(sessionId, text))}
          />
        </div>
      ) : session.status === 'documented' ? (
        <div className="grid gap-4">
          <SlotReview
            slots={slotStates}
            submitting={busy}
            onConfirm={(slotKey) =>
              void confirmSlotOk(sessionId, slotKey)
                .then(() => refetch())
                .catch((e) => setError(e instanceof Error ? e.message : '확인 실패'))
            }
            onCorrect={(slotKey, text) => void act(() => correctSlot(sessionId, slotKey, text))}
          />
          <DocumentView text={documentText} />
          <p className="text-center text-sm text-muted-foreground">
            다음은 개발팀 검토예요 — 이 단계는 준비 중이라, 지금은 완성된 문서가 개발팀에 그대로
            전달됩니다.
          </p>
        </div>
      ) : onHold ? (
        <HoldCard
          slots={slotStates}
          submitting={busy}
          onResume={(text) => void act(() => sendReply(sessionId, text))}
        />
      ) : (
        <Alert>
          <AlertTitle>세션이 종결됐어요</AlertTitle>
          <AlertDescription>새 요청은 홈에서 시작할 수 있어요.</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>진행에 문제가 생겼어요</AlertTitle>
          <AlertDescription className="grid gap-2">
            <span>{error}</span>
            <span>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                이어서 진행
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
    </Shell>
  );
}

function Shell({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          pm-jude <span className="font-normal text-muted-foreground">· 요청 인테이크</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            요청 {sessionId.slice(0, 8)}
          </Badge>
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            내 요청
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
