'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AckCard } from '@/components/ack-card';
import { DocumentView } from '@/components/document-view';
import { HoldCard } from '@/components/hold-card';
import { Jude, type JudeHandle } from '@/components/jude';
import { JourneyStepper } from '@/components/journey-stepper';
import { QuestionWizard } from '@/components/question-wizard';
import { RetryCard } from '@/components/retry-card';
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
import { t, sessionLang, useLang, type Lang } from '@/lib/i18n';
import { judeState, type JudeState } from '@/lib/jude-geometry';
import {
  allSlotsConfirmed,
  fullyPromoted,
  isLastRound,
  journeyStep,
  roundFailed,
} from '@/lib/stage';
import { ApiError, type SessionDetail } from '@/lib/types';
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
  const [typing, setTyping] = useState(false);
  const watchingRef = useRef(false);
  const judeRef = useRef<JudeHandle>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 화면 언어는 세션의 요청자 언어를 따른다 — 전사가 근거다 (F2b)
  const lang = useLang(detail ? sessionLang(detail.utterances) : null);

  /** 키 입력 한 번 = 소리 한 번. 멎으면 자세가 곧 풀린다 (docs/persona/jude.md). */
  const onType = useCallback(() => {
    judeRef.current?.hear();
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 700);
  }, []);

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
      // 스테일 라운드(G-10)는 오류가 아니라 다른 탭이 앞서간 것 — 최신 질문을 가져온다
      const stale = e instanceof ApiError && e.code === 'stale_round';
      setError(
        stale
          ? t(lang, 'retry.staleRound')
          : e instanceof Error
            ? e.message
            : t(lang, 'session.actionFailed'),
      );
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <Shell lang={lang} sessionId={sessionId} judeState="failed">
        <Alert variant="destructive">
          <AlertTitle>{t(lang, 'session.notFoundTitle')}</AlertTitle>
          <AlertDescription>
            {t(lang, 'session.notFoundBody')}{' '}
            <Link className="underline" href="/">
              {t(lang, 'nav.home')}
            </Link>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }
  if (!detail) {
    return (
      <Shell lang={lang} sessionId={sessionId} judeState="thinking">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    );
  }

  const {
    session,
    latestQuestions,
    roundId,
    documentVersion,
    roundBudget,
    slotStates,
    utterances,
    processing,
  } = detail;
  const onHold =
    session.status === 'closed' && session.terminalState === 'on_hold_insufficient_info';
  // 미완 라운드 판정은 상태와 전사로 유도한다 — 답변만 남고 응답이 없으면 라운드가 죽은 것 (G-10)
  const failed = roundFailed(session.status, utterances, processing || busy);
  const documentText = utterances.findLast((u) => u.authorType === 'agent')?.originalText ?? '';
  const completed = allSlotsConfirmed(slotStates); // Phase 0 종착 (G-11)

  const face = judeState({
    status: session.status,
    terminalState: session.terminalState,
    processing: processing || busy,
    typing,
    failed,
  });

  function retry() {
    setError(null);
    void retryRound(sessionId)
      .then(() => watchThenRefetch())
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : t(lang, 'session.retryFailed'));
        return refetch();
      });
  }

  return (
    <Shell lang={lang} sessionId={sessionId} judeState={face} judeRef={judeRef}>
      <JourneyStepper
        lang={lang}
        current={journeyStep(session.status)}
        note={
          onHold
            ? t(lang, 'journey.onHold')
            : completed
              ? t(lang, 'journey.done') // 확인 완료가 ③ 위에 표시된다 (G-11)
              : undefined
        }
      />

      <Transcript
        lang={lang}
        entries={utterances.map((u) => ({
          who: u.authorType === 'requester' ? 'requester' : 'agent',
          text: u.originalText,
        }))}
      />

      {/* 미완 라운드는 재제출이 아니라 멱등 재시도로 복구한다 (G-10) */}
      {failed && session.status !== 'intake' && (
        <RetryCard lang={lang} submitting={busy} onRetry={retry} />
      )}

      {session.status === 'intake' ? (
        <AckCard lang={lang} sessionId={sessionId} failed={failed} onRetry={retry} />
      ) : busy || processing ? (
        <WaitingCard lang={lang} phase="reply" />
      ) : session.status === 'clarifying' ? (
        // 라운드가 죽은 동안 마법사를 감춘다 — 같은 답을 다시 적으면 발화가 중복 기록된다
        failed ? null : (
          <div className="grid gap-4">
            {session.roundCount > 1 && <RoundContext lang={lang} slots={slotStates} />}
            <QuestionWizard
              lang={lang}
              key={`${session.roundCount}-${latestQuestions?.[0]?.question ?? ''}`}
              questions={latestQuestions ?? []}
              round={Math.max(session.roundCount, 1)}
              lastRound={isLastRound(session.roundCount, roundBudget)}
              onType={onType}
              onSubmit={(text) => void act(() => sendReply(sessionId, text, roundId))}
            />
          </div>
        )
      ) : session.status === 'documented' ? (
        <div className="grid gap-4">
          <SlotReview
            lang={lang}
            slots={slotStates}
            submitting={busy || failed}
            onConfirm={(slotKey) =>
              void confirmSlotOk(sessionId, slotKey)
                .then(() => refetch())
                .catch((e) =>
                  setError(e instanceof Error ? e.message : t(lang, 'session.confirmFailed')),
                )
            }
            onCorrect={(slotKey, text) => void act(() => correctSlot(sessionId, slotKey, text))}
          />
          <DocumentView
            lang={lang}
            text={documentText}
            version={documentVersion}
            fullyPromoted={fullyPromoted(slotStates)}
          />
          {completed ? (
            <Alert>
              <AlertTitle>{t(lang, 'doc.completedTitle')}</AlertTitle>
              <AlertDescription>{t(lang, 'doc.completedBody')}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-center text-sm text-muted-foreground">{t(lang, 'doc.nextStep')}</p>
          )}
        </div>
      ) : onHold ? (
        <HoldCard
          lang={lang}
          slots={slotStates}
          submitting={busy}
          onType={onType}
          onResume={(text) => void act(() => sendReply(sessionId, text))}
        />
      ) : (
        <Alert>
          <AlertTitle>{t(lang, 'session.closedTitle')}</AlertTitle>
          <AlertDescription>{t(lang, 'session.closedBody')}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t(lang, 'session.errorTitle')}</AlertTitle>
          <AlertDescription className="grid gap-2">
            <span>{error}</span>
            <span>
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                {t(lang, 'common.continue')}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
    </Shell>
  );
}

function Shell({
  lang,
  sessionId,
  judeState: face,
  judeRef,
  children,
}: {
  lang: Lang;
  sessionId: string;
  judeState: JudeState;
  judeRef?: React.RefObject<JudeHandle | null>;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-center gap-3">
        <Jude ref={judeRef} state={face} size={56} className="-my-1" />
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Jude <span className="font-normal text-muted-foreground">· {t(lang, 'brand.sub')}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[11px]">
            {t(lang, 'common.request')} {sessionId.slice(0, 8)}
          </Badge>
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t(lang, 'nav.myRequests')}
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
