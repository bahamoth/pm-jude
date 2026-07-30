'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getMockupState, mockupUrl } from '@/lib/api';
import { t, type Lang } from '@/lib/i18n';
import type { MockupState } from '@/lib/types';

interface Props {
  lang: Lang;
  sessionId: string;
}

/**
 * 확정된 목업 열람 (#66) — 반복이 끝난 뒤에도 요청자가 자기가 승인한 화면을 다시 볼 수 있다.
 *
 * 승인 후 상태는 `documented`로 돌아가는데 그 분기에 목업 패널이 없어서, 데이터는 남아 있고
 * 서버도 서빙하는데 **화면에 문이 없었다**. 읽기 전용이다: 코멘트·테마 선정·승인은 끝난 일이고,
 * 구현의 기준은 문서다(원칙 7 — 목업은 참고용).
 *
 * 접힌 상태로 시작한다 — 이 단계의 주역은 문서이고, 목업은 찾을 수 있으면 된다.
 */
export function MockupArchive({ lang, sessionId }: Props) {
  const [state, setState] = useState<MockupState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    void getMockupState(sessionId)
      .then((next) => {
        if (alive) setState(next);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (error || (state !== null && state.latestVersion === 0)) return null;

  const frameSrc = state ? mockupUrl(sessionId, state.latestVersion, state.selectedTheme) : '';
  const themeLabel = state?.themeDelegated
    ? t(lang, 'mockupArchive.themeDelegated')
    : (state?.themes.find((theme) => theme.id === state.selectedTheme)?.name ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="hover:underline"
          >
            {t(lang, 'mockupArchive.title')}
          </button>
          {state && (
            <Badge variant="outline" className="font-mono text-[11px]">
              {t(lang, 'mockup.version', { version: state.latestVersion })}
            </Badge>
          )}
          {themeLabel && (
            <Badge variant="secondary" className="text-[11px]">
              {themeLabel}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{t(lang, 'mockupArchive.lede')}</CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="grid gap-3">
          {state === null ? (
            <Skeleton className="h-[420px] w-full" />
          ) : (
            <>
              {/* 목업은 LLM 산출물이다 — 확정 뒤에도 앱 컨텍스트와 격리한다 (F4) */}
              <iframe
                key={frameSrc}
                src={frameSrc}
                sandbox="allow-scripts"
                title={t(lang, 'mockup.frameTitle')}
                className="h-[420px] w-full rounded-md border bg-white"
              />
              <div className="text-right">
                <a
                  href={frameSrc}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-muted-foreground underline"
                >
                  {t(lang, 'mockup.openNew')}
                </a>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
