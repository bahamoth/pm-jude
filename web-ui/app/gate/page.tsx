'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { decideGate, getGate } from '@/lib/api';
import { decisionReady, rejectReasonKey } from '@/lib/gate';
import { t, useLang, type Key, type Lang } from '@/lib/i18n';
import {
  ApiError,
  type GateDecision,
  type GateDecisionOutcome,
  type GatePendingItem,
} from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * 승인 게이트 (F5 #69) — 개발자 표면. 요청자 화면이 아니므로 Jude 페르소나 밖이고,
 * 결정(승인·백로그·거절)은 되돌릴 수 없어 인라인 확인 단계를 거친다 (ux-conventions:
 * "Confirm only what cannot be undone" — 이 셋이 정확히 그 경우다).
 */

const DECIDED_BY_KEY = 'pmjude.gate.decidedBy';

export default function GatePage() {
  const lang = useLang(null);
  const [pending, setPending] = useState<GatePendingItem[] | null>(null);
  const [rejectReasons, setRejectReasons] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [raced, setRaced] = useState(false);
  const [decidedBy, setDecidedBy] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await getGate();
      setPending(data.pending);
      setRejectReasons(data.rejectReasons);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t(lang, 'gate.loadFailed'));
    }
  }, [lang]);

  useEffect(() => {
    try {
      // 저장된 결정자 복원은 마운트 후에만 가능(SSR에는 localStorage가 없다) — 부팅 1회 반영
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecidedBy(localStorage.getItem(DECIDED_BY_KEY) ?? '');
    } catch {
      // 프라이빗 모드 등 — 기억 못 해도 화면은 동작해야 한다
    }
    void refresh();
  }, [refresh]);

  function rememberDecidedBy(value: string) {
    setDecidedBy(value);
    try {
      localStorage.setItem(DECIDED_BY_KEY, value);
    } catch {
      // 위와 같음
    }
  }

  /** 다른 곳이 앞서간 항목 — 오류가 아니라 목록 갱신 신호다. */
  function onRaced() {
    setRaced(true);
    void refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{t(lang, 'gate.title')}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            {t(lang, 'gate.refresh')}
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted-foreground">{t(lang, 'gate.lede')}</p>

      <div className="flex items-center gap-2">
        <Label htmlFor="decided-by" className="shrink-0 text-sm text-muted-foreground">
          {t(lang, 'gate.decidedBy')}
        </Label>
        <Input
          id="decided-by"
          className="max-w-48"
          value={decidedBy}
          placeholder={t(lang, 'gate.decidedByPlaceholder')}
          onChange={(e) => rememberDecidedBy(e.target.value)}
        />
      </div>

      {raced && (
        <Alert>
          <AlertDescription>{t(lang, 'gate.raced')}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>{t(lang, 'gate.loadFailed')}</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {pending === null ? (
        <>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </>
      ) : pending.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t(lang, 'gate.empty')}</p>
      ) : (
        pending.map((item) => (
          <GateItemCard
            key={item.id}
            lang={lang}
            item={item}
            rejectReasons={rejectReasons}
            decidedBy={decidedBy}
            onRaced={onRaced}
          />
        ))
      )}
    </div>
  );
}

const DECISION_LABEL: Record<GateDecision, Key> = {
  approve: 'gate.approve',
  question: 'gate.question',
  backlog: 'gate.backlog',
  reject: 'gate.reject',
};

const COMMIT_LABEL: Record<GateDecision, Key> = {
  approve: 'gate.approveCommit',
  question: 'gate.questionCommit',
  backlog: 'gate.backlogCommit',
  reject: 'gate.rejectCommit',
};

const COMMIT_NOTE: Record<GateDecision, Key> = {
  approve: 'gate.approveNote',
  question: 'gate.questionNote',
  backlog: 'gate.backlogNote',
  reject: 'gate.rejectNote',
};

function GateItemCard({
  lang,
  item,
  rejectReasons,
  decidedBy,
  onRaced,
}: {
  lang: Lang;
  item: GatePendingItem;
  rejectReasons: string[];
  decidedBy: string;
  onRaced: () => void;
}) {
  /** 열려 있는 인라인 결정 패널 — 결정은 한 번에 하나씩 본다. */
  const [mode, setMode] = useState<GateDecision | null>(null);
  const [note, setNote] = useState('');
  const [reasonTag, setReasonTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GateDecisionOutcome | null>(null);

  async function commit(decision: GateDecision) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await decideGate(item.id, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === 'reject' && reasonTag ? { reasonTag } : {}),
        ...(decidedBy.trim() ? { decidedBy: decidedBy.trim() } : {}),
      });
      setResult(outcome);
      setMode(null);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'already_decided' || e.code === 'stale_gate')) {
        onRaced();
        return;
      }
      setError(e instanceof Error ? e.message : t(lang, 'session.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  // 결정 완료 카드 — 방금 무엇이 일어났는지가 목록 갱신에 지워지지 않는다 (완료 상태의 명료성)
  if (result) {
    return (
      <Card>
        <CardContent className="grid gap-2 pt-6">
          <ItemSummary lang={lang} item={item} />
          {result.decision === 'approve' && result.issue ? (
            <Alert>
              <AlertTitle>
                {t(lang, 'gate.decidedIssue', { identifier: result.issue.identifier })}
              </AlertTitle>
              <AlertDescription className="grid gap-1">
                <a
                  className="underline"
                  href={result.issue.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {result.issue.url}
                </a>
                {result.issue.connector === 'fake' && (
                  <span>{t(lang, 'gate.decidedFakeNote')}</span>
                )}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                {t(
                  lang,
                  result.decision === 'question'
                    ? 'gate.decidedQuestion'
                    : result.decision === 'backlog'
                      ? 'gate.decidedBacklog'
                      : 'gate.decidedReject',
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-3 pt-6">
        <ItemSummary lang={lang} item={item} />

        {/* 결정 버튼은 대상 카드 안에 있다 (proximity) — 패널은 버튼 바로 아래에서 열린다 */}
        <div className="flex flex-wrap gap-2">
          {(['approve', 'question', 'backlog', 'reject'] as const).map((decision) => (
            <Button
              key={decision}
              size="sm"
              variant={
                decision === 'approve'
                  ? 'default'
                  : decision === 'reject'
                    ? 'destructive'
                    : 'outline'
              }
              disabled={busy}
              onClick={() => setMode(mode === decision ? null : decision)}
            >
              {t(lang, DECISION_LABEL[decision])}
            </Button>
          ))}
          <Link
            href={`/s/${item.sessionId}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'ml-auto')}
          >
            {t(lang, 'gate.openSession')}
          </Link>
        </div>

        {mode && (
          <div
            className="grid gap-2 rounded-md border p-3"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMode(null);
            }}
          >
            {mode === 'question' && (
              <>
                <Label htmlFor={`note-${item.id}`}>{t(lang, 'gate.questionLabel')}</Label>
                <Textarea
                  id={`note-${item.id}`}
                  autoFocus
                  value={note}
                  placeholder={t(lang, 'gate.questionPlaceholder')}
                  onChange={(e) => setNote(e.target.value)}
                />
              </>
            )}
            {mode === 'reject' && (
              <>
                <Label>{t(lang, 'gate.rejectLabel')}</Label>
                <RadioGroup value={reasonTag} onValueChange={(value) => setReasonTag(value)}>
                  {rejectReasons.map((tag) => {
                    const key = rejectReasonKey(tag);
                    return (
                      <div key={tag} className="flex items-center gap-2">
                        <RadioGroupItem value={tag} id={`${item.id}-${tag}`} />
                        <Label htmlFor={`${item.id}-${tag}`} className="font-normal">
                          {key ? t(lang, key) : tag}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
              </>
            )}
            {/* 커밋 전에 무엇이 일어나는지 말한다 — 결정의 blast radius 가시화 */}
            <p className="text-xs text-muted-foreground">{t(lang, COMMIT_NOTE[mode])}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={mode === 'reject' ? 'destructive' : 'default'}
                disabled={busy || !decisionReady(mode, { note, reasonTag })}
                onClick={() => void commit(mode)}
              >
                {t(lang, COMMIT_LABEL[mode])}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode(null)}>
                {t(lang, 'gate.cancel')}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ItemSummary({ lang, item }: { lang: Lang; item: GatePendingItem }) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {item.sessionId.slice(0, 8)}
        </Badge>
        <Badge variant="secondary">
          {t(lang, 'gate.docVersion', { version: item.docVersion })}
        </Badge>
        {item.isConditional && (
          <Badge variant="outline" className="border-dashed">
            {t(lang, 'gate.conditional', { count: item.openIssueCount })}
          </Badge>
        )}
        <Badge variant={item.completed ? 'secondary' : 'outline'}>
          {t(lang, item.completed ? 'gate.completedBadge' : 'gate.notCompletedBadge')}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {item.submittedAt.slice(0, 16).replace('T', ' ')}
        </span>
      </div>
      {item.problem && (
        <p className="text-sm">
          <span className="mr-1 font-medium">{t(lang, 'gate.problemLabel')}</span>
          {item.problem}
        </p>
      )}
      <p className="line-clamp-3 text-sm text-muted-foreground">
        <span className="mr-1 font-medium text-foreground">{t(lang, 'gate.requestLabel')}</span>
        {item.requestText}
      </p>
    </div>
  );
}
