'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface Props {
  sessionId: string;
  /** 백그라운드 질문 생성 실패 시 재시도 */
  failed?: boolean;
  onRetry?: () => void;
}

/**
 * 접수 직후 화면 (G-1, F1) — 접수 사실·요청 ID를 즉시 보여주고 질문 생성을 기다린다.
 * 딥링크 안내(M-2)와 보존 고지(M-4)로 「떠나도 된다」를 명시한다.
 */
export function AckCard({ sessionId, failed, onRetry }: Props) {
  const [copied, setCopied] = useState(false);

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        {failed ? (
          <>
            <p className="text-base font-medium">질문 생성에 문제가 생겼어요</p>
            <Button size="sm" onClick={onRetry}>
              다시 시도
            </Button>
          </>
        ) : (
          <>
            <Spinner className="size-7 text-primary" />
            <p className="text-base font-medium">요청이 접수됐어요 — 확인 질문을 만들고 있어요</p>
            <p className="text-sm text-muted-foreground">보통 1분 이내, 길면 2분까지 걸려요</p>
          </>
        )}
        <div className="mt-2 grid gap-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <p>
            요청 번호 <span className="font-mono text-foreground">{sessionId.slice(0, 8)}</span> ·
            내용은 서버에 저장돼 사라지지 않아요.
          </p>
          <p>
            이 페이지 주소가 요청으로 가는 링크예요 — 링크만 있으면 다른 브라우저에서도 이어집니다.
          </p>
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
            {copied ? '복사됐어요' : '링크 복사'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
