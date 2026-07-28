'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getMockupState, mockupUrl } from '@/lib/api';
import { t, type Lang } from '@/lib/i18n';
import type { MockupState } from '@/lib/types';

interface Props {
  lang: Lang;
  sessionId: string;
  submitting: boolean;
  onComment: (mockupVersion: number, comments: Array<{ text: string }>) => void;
  onSelectTheme: (selection: { themeId: string } | { delegated: true }) => void;
  onApprove: () => void;
}

/**
 * 목업 반복 패널 (F4, #54) — 샌드박스 iframe으로 목업을 보여주고 코멘트·테마 선정·최종
 * 확인을 받는다. iframe은 allow-scripts만 준다(allow-same-origin 배제 — F4 호스팅·보안).
 * 테마를 고르면 즉시 선정 API로 기록되고 서빙 기본값이 바뀐다 — 확정 전까지 다시 고를 수 있다.
 */
export function MockupPanel({
  lang,
  sessionId,
  submitting,
  onComment,
  onSelectTheme,
  onApprove,
}: Props) {
  const [state, setState] = useState<MockupState | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getMockupState(sessionId).then(
      (next) => {
        if (!cancelled) setState(next);
      },
      () => {
        if (!cancelled) setState(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!state) {
    return <Skeleton className="h-96 w-full" />;
  }

  const iterationsLeft = Math.max(0, state.iterationBudget - state.iterationsUsed);
  const themeDecided = state.selectedTheme !== null || state.themeDelegated;
  const frameSrc = mockupUrl(sessionId, state.latestVersion, state.selectedTheme);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {t(lang, 'mockup.title')}
          <Badge variant="outline" className="font-mono text-[11px]">
            {t(lang, 'mockup.version', { version: state.latestVersion })}
          </Badge>
          <Badge variant="secondary" className="text-[11px]">
            {t(lang, 'mockup.iterationsLeft', { left: iterationsLeft })}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t(lang, 'mockup.lede')}
          {!themeDecided && <> {t(lang, 'mockup.grayscaleNote')}</>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* 목업은 요청자가 올린 것이 아니라 LLM 산출물이다 — 그래도 앱 컨텍스트와 격리한다 (F4) */}
        <iframe
          key={frameSrc}
          src={frameSrc}
          sandbox="allow-scripts"
          title={t(lang, 'mockup.frameTitle')}
          className="h-[480px] w-full rounded-md border bg-white"
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

        {/* 코멘트 → 다음 판 (반복 예산 안에서) */}
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t(lang, 'mockup.commentTitle')}</p>
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t(lang, 'mockup.commentPlaceholder')}
            disabled={submitting}
            rows={3}
          />
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={submitting || !comment.trim()}
              onClick={() => {
                const text = comment.trim();
                setComment('');
                onComment(state.latestVersion, [{ text }]);
              }}
            >
              {t(lang, 'mockup.sendComment')}
            </Button>
          </div>
          {state.annotations.length > 0 && (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              <li className="font-medium text-foreground">
                {t(lang, 'mockup.annotationsTitle')}
              </li>
              {state.annotations.map((annotation, index) => (
                <li key={index}>
                  <span className="font-mono text-[11px]">
                    v{annotation.mockupVersion ?? '?'}
                  </span>{' '}
                  {annotation.text}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />

        {/* 디자인 시스템 선정 — 후보는 테마 레지스트리(내장 + 외부 등록)에서 온다 */}
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t(lang, 'mockup.themeTitle')}</p>
          <p className="text-sm text-muted-foreground">{t(lang, 'mockup.themeLede')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {state.themes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                disabled={submitting}
                onClick={() => onSelectTheme({ themeId: theme.id })}
                className={`rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent ${
                  state.selectedTheme === theme.id ? 'border-primary ring-1 ring-primary' : ''
                }`}
              >
                <span className="font-medium">{theme.name}</span>
                <span className="mt-1 block text-muted-foreground">{theme.description}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={state.themeDelegated ? 'default' : 'ghost'}
              disabled={submitting}
              onClick={() => onSelectTheme({ delegated: true })}
            >
              {t(lang, 'mockup.themeDelegate')}
            </Button>
            {state.themeDelegated && (
              <span className="text-sm text-muted-foreground">
                {t(lang, 'mockup.themeDelegated')}
              </span>
            )}
          </div>
        </div>

        <Separator />

        {/* 최종 확인 → 역주입 (F4 — 목업에만 있는 확정 사항을 남기지 않는다) */}
        <div className="grid gap-2">
          <Button disabled={submitting || !themeDecided} onClick={onApprove}>
            {t(lang, 'mockup.approve')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {themeDecided ? t(lang, 'mockup.approveHint') : t(lang, 'mockup.approveNeedsTheme')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
