'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t, type Lang } from '@/lib/i18n';

/**
 * 미완 라운드의 재시도 (G-10, #28 S-4) — 답변은 이미 서버에 저장돼 있으므로 여기서 하는 일은
 * 재제출이 아니라 죽은 단계의 멱등 재실행이다. 요청자가 같은 답을 다시 적지 않게 한다.
 */
export function RetryCard({
  lang,
  submitting,
  onRetry,
}: {
  lang: Lang;
  submitting: boolean;
  onRetry: () => void;
}) {
  return (
    <Alert>
      <AlertTitle>{t(lang, 'retry.title')}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <span>{t(lang, 'retry.body')}</span>
        <span>
          <Button size="sm" variant="outline" disabled={submitting} onClick={onRetry}>
            {t(lang, 'common.retry')}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
