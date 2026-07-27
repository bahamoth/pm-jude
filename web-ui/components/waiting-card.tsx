'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { t, type Lang, type Key } from '@/lib/i18n';

// LLM 대기 구간의 침묵 방지 (US-2) — 단계 메시지 회전 + 경과 시간 + 장기 대기 안내.
const MESSAGES: Record<'intake' | 'reply', Key[]> = {
  intake: ['wait.intake.1', 'wait.intake.2', 'wait.intake.3'],
  reply: ['wait.reply.1', 'wait.reply.2', 'wait.reply.3'],
};

export function WaitingCard({ lang, phase }: { lang: Lang; phase: 'intake' | 'reply' }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const messages = MESSAGES[phase];
  const overdue = seconds > 120;
  const message = overdue
    ? t(lang, 'wait.overdue')
    : t(lang, messages[Math.floor(seconds / 4) % messages.length]);

  return (
    <Card aria-busy="true" aria-live="polite">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <Spinner className="size-8 text-primary" />
        <p className="text-base font-medium">{message}</p>
        <p className="text-sm text-muted-foreground">
          {t(lang, 'wait.elapsed', { seconds })} ·{' '}
          {t(lang, overdue ? 'wait.overdueEta' : 'wait.normalEta')}
        </p>
        <p className="text-xs text-muted-foreground">{t(lang, 'wait.leaveOk')}</p>
      </CardContent>
    </Card>
  );
}
