'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

// LLM 대기 구간의 침묵 방지 (US-2) — 단계 메시지 회전 + 경과 시간 + 장기 대기 안내.
const MESSAGES: Record<'intake' | 'reply', string[]> = {
  intake: [
    '요청을 접수하고 있어요…',
    '요청을 여러 갈래로 해석해 보고 있어요…',
    '확인이 필요한 지점을 골라 질문을 만들고 있어요…',
  ],
  reply: [
    '답변을 요구사항 슬롯에 반영하고 있어요…',
    '완결성 판정을 하고 있어요…',
    '다음 단계를 준비하고 있어요…',
  ],
};

export function WaitingCard({ phase }: { phase: 'intake' | 'reply' }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const messages = MESSAGES[phase];
  const overdue = seconds > 120;
  const message = overdue
    ? '평소보다 오래 걸리고 있어요 — 조금만 더 기다려 주세요.'
    : messages[Math.floor(seconds / 4) % messages.length];

  return (
    <Card aria-busy="true" aria-live="polite">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <Spinner className="size-8 text-primary" />
        <p className="text-base font-medium">{message}</p>
        <p className="text-sm text-muted-foreground">
          {seconds}초 경과 ·{' '}
          {overdue ? '응답이 없으면 곧 자동으로 중단돼요' : '보통 수십 초, 길면 2분까지 걸려요'}
        </p>
        <p className="text-xs text-muted-foreground">
          세션은 저장되고 있어요 — 페이지를 닫아도 이어서 진행할 수 있습니다.
        </p>
      </CardContent>
    </Card>
  );
}
