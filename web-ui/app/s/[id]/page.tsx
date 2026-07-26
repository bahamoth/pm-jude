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
import { confirmSlot, getSession, retryRound, sendReply } from '@/lib/api';
import { rememberSession } from '@/lib/local-sessions';
import { isLastRound, journeyStep } from '@/lib/stage';
import type { SessionDetail } from '@/lib/types';

/**
 * 세션 화면 (딥링크 /s/:id — P-U2 상시 재개). 서버 status가 화면의 유일한 근거다.
 * SSE는 수명 규칙(#31)대로 서버 처리 구간에만 연다: 질문 생성 중(intake)에 열고,
 * 라운드 완료(status 이벤트)에 닫는다. 무응답 방치 구간에는 연결이 없다.
 */
export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roundFailed, setRoundFailed] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const stopStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  /** 질문 생성 진행 구간에만 SSE를 연다 — 완료 status를 받으면 닫는다 (#31 수명 규칙). */
  const streamWhileProcessing = useCallback(() => {
    if (sourceRef.current) return;
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    sourceRef.current = source;
    source.addEventListener('status', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { status: string };
      if (data.status !== 'intake') {
        stopStream();
        void refetch();
      }
    });
    source.addEventListener('error', (event) => {
      // 서버가 보낸 라운드 실패 이벤트 (EventSource 연결 오류와 구분: data 유무)
      if ((event as MessageEvent<string>).data) {
        setRoundFailed(true);
        stopStream();
      }
    });
    source.onerror = () => {
      // 연결 실패 — 조회 폴링으로 강등 (#31 폴백)
      if (source.readyState === EventSource.CLOSED && !pollRef.current) {
        pollRef.current = setInterval(() => {
          void refetch().then((next) => {
            if (next && next.session.status !== 'intake') stopStream();
          });
        }, 3000);
      }
    };
  }, [refetch, sessionId, stopStream]);

  useEffect(() => {
    rememberSession(sessionId);
    // 부팅 조회는 마운트 후에만 가능(딥링크 진입) — 상태 반영은 응답 후 비동기
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refetch();
    return stopStream;
  }, [refetch, sessionId, stopStream]);

  // intake 상태를 관측하면 처리 중 — 스트림을 연다 (라운드 완료 시 자동 종료)
  useEffect(() => {
    if (detail?.session.status === 'intake' && !roundFailed) streamWhileProcessing();
  }, [detail?.session.status, roundFailed, streamWhileProcessing]);

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : '처리 실패');
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

  const { session, latestQuestions, roundBudget, slotStates, utterances } = detail;
  const onHold =
    session.status === 'closed' && session.terminalState === 'on_hold_insufficient_info';
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

      {busy ? (
        <WaitingCard phase="reply" />
      ) : session.status === 'intake' ? (
        <AckCard
          sessionId={sessionId}
          failed={roundFailed}
          onRetry={() => {
            setRoundFailed(false);
            void retryRound(sessionId).then(() => streamWhileProcessing());
          }}
        />
      ) : session.status === 'clarifying' ? (
        <div className="grid gap-4">
          {session.roundCount > 1 && <RoundContext slots={slotStates} />}
          <QuestionWizard
            key={session.roundCount} // 라운드가 바뀌면 마법사 상태 초기화
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
            onConfirm={(slotKey) => void act(() => confirmSlot(sessionId, slotKey, true))}
            onCorrect={(slotKey, text) =>
              void act(() => confirmSlot(sessionId, slotKey, false, text))
            }
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
