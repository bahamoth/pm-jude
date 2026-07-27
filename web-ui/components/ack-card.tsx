'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { t, type Lang } from '@/lib/i18n';

interface Props {
  lang: Lang;
  sessionId: string;
  /** 백그라운드 질문 생성 실패 시 재시도 */
  failed?: boolean;
  onRetry?: () => void;
}

/**
 * 접수 직후 화면 (G-1, F1) — 접수 사실·요청 ID를 즉시 보여주고 질문 생성을 기다린다.
 * 딥링크 안내(M-2)와 보존 고지(M-4)로 「떠나도 된다」를 명시한다.
 */
export function AckCard({ lang, sessionId, failed, onRetry }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        {failed ? (
          <>
            <p className="text-base font-medium">{t(lang, 'ack.failedTitle')}</p>
            <Button size="sm" onClick={onRetry}>
              {t(lang, 'common.retry')}
            </Button>
          </>
        ) : (
          <>
            <Spinner className="size-7 text-primary" />
            <p className="text-base font-medium">{t(lang, 'ack.title')}</p>
            <p className="text-sm text-muted-foreground">{t(lang, 'ack.eta')}</p>
          </>
        )}
        <div className="mt-2 grid gap-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <p>{t(lang, 'ack.stored', { id: sessionId.slice(0, 8) })}</p>
          <p>{t(lang, 'ack.deepLink')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mx-auto mt-1"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {t(lang, copied ? 'common.copied' : 'common.copyLink')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
