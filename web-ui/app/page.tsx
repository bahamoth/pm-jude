'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IntakeForm, type IntakeInput } from '@/components/intake-form';
import { Jude, type JudeHandle } from '@/components/jude';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getSummaries, startSession } from '@/lib/api';
import { listSessionIds, rememberSession } from '@/lib/local-sessions';
import { t, useLang, type Lang } from '@/lib/i18n';
import { statusChip } from '@/lib/stage';
import type { SessionSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

const CHIP_TONE: Record<string, string> = {
  action: 'bg-primary text-primary-foreground',
  progress: 'bg-secondary text-secondary-foreground',
  hold: 'border border-dashed text-muted-foreground bg-transparent',
  done: 'bg-muted text-muted-foreground',
};

/**
 * 홈 — 내 요청 목록(#29 브라우저 로컬 목록) + 새 요청.
 * 목록은 이 브라우저가 보관한 세션 ID의 조회일 뿐, 데이터는 서버가 영속한다.
 */
export default function Home() {
  const router = useRouter();
  const [summaries, setSummaries] = useState<SessionSummary[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [langPick, setLangPick] = useState<Lang | null>(null);
  const lang = useLang(langPick);
  const judeRef = useRef<JudeHandle>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 키 입력 한 번 = 소리 한 번. 요청을 적는 동안 Jude가 그쪽으로 고개를 돌린다. */
  const onType = useCallback(() => {
    judeRef.current?.hear();
    setTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 700);
  }, []);

  useEffect(() => {
    const ids = listSessionIds();
    getSummaries(ids)
      .then(({ sessions }) => {
        const order = new Map(ids.map((id, i) => [id, i]));
        setSummaries(
          [...sessions].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99)),
        );
      })
      .catch(() => setSummaries([]));
  }, []);

  async function handleIntake(input: IntakeInput) {
    setError(null);
    try {
      const result = await startSession(input);
      rememberSession(result.sessionId);
      router.push(`/s/${result.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, 'intake.failed'));
    }
  }

  const hasSessions = (summaries?.length ?? 0) > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-5 py-8">
      <header className="flex items-center gap-3">
        <Jude ref={judeRef} state={typing ? 'listening' : 'idle'} size={56} className="-my-1" />
        <h1 className="text-lg font-semibold tracking-tight">
          Jude <span className="font-normal text-muted-foreground">· {t(lang, 'brand.sub')}</span>
        </h1>
        {hasSessions && !showForm && (
          <Button className="ml-auto" size="sm" onClick={() => setShowForm(true)}>
            {t(lang, 'nav.newRequest')}
          </Button>
        )}
      </header>

      {summaries === null && <Skeleton className="h-40 w-full" />}

      {summaries !== null && (!hasSessions || showForm) && (
        <>
          <IntakeForm
            lang={lang}
            onLangChange={setLangPick}
            onType={onType}
            onSubmit={(input) => void handleIntake(input)}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}

      {hasSessions && (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t(lang, 'nav.myRequests')}</h2>
          {summaries?.map((summary) => {
            const chip = statusChip(summary.status, summary.terminalState);
            return (
              <Link key={summary.id} href={`/s/${summary.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{summary.requestText}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {summary.id.slice(0, 8)} · {new Date(summary.updatedAt).toLocaleString()}
                        {summary.openIssueCount > 0 &&
                          ` · ${t(lang, 'home.openIssues', { count: summary.openIssueCount })}`}
                      </p>
                    </div>
                    <Badge className={cn('shrink-0 border-transparent', CHIP_TONE[chip.tone])}>
                      {t(lang, chip.labelKey)}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          <p className="text-xs text-muted-foreground">{t(lang, 'home.listNote')}</p>
        </section>
      )}
    </div>
  );
}
