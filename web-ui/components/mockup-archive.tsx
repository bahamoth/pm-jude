'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { getMockupState, mockupUrl } from '@/lib/api';
import { t, type Lang } from '@/lib/i18n';
import type { MockupState } from '@/lib/types';

interface Props {
  lang: Lang;
  sessionId: string;
  submitting?: boolean;
  /** 개선 반복 재개 (#67) — 코멘트가 닫힌 판을 다시 열고 새 판을 만든다. */
  onRevise?: (mockupVersion: number, comments: Array<{ text: string }>) => void;
}

/**
 * 확정된 목업 열람과 개선 재개 (#66 · #67) — 반복이 끝난 뒤에도 요청자가 자기가 승인한 화면을
 * 다시 보고, 다시 고칠 수 있다.
 *
 * 승인 후 상태는 `documented`로 돌아가는데 그 분기에 목업 패널이 없어서, 데이터는 남아 있고
 * 서버도 서빙하는데 **화면에 문이 없었다**(#66). 열람만 열었더니 이번엔 **고칠 문이 없었다**
 * (#67) — 문서를 상시 교정 가능하게 만든 것과 같은 이유로 화면도 상시 개선 가능해야 한다:
 * 요청자가 화면 기대를 맞추는 수단이 「한 번 승인했으니 끝」으로 잠기면 어긋남을 고칠 길이 없다.
 *
 * 접힌 상태로 시작한다 — 이 단계의 주역은 문서이고, 목업은 찾을 수 있으면 된다. 고치기를 누르면
 * 카드가 펼쳐진다: 무엇을 고치는지 보지 않고 코멘트를 쓰게 하지 않는다.
 */
export function MockupArchive({ lang, sessionId, submitting = false, onRevise }: Props) {
  const [state, setState] = useState<MockupState | null>(null);
  const [open, setOpen] = useState(false);
  const [revising, setRevising] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

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

  // 고치기를 열면 입력으로 포커스가 간다 — 추가 클릭을 발견하게 두지 않는다 (ux-conventions)
  useEffect(() => {
    if (revising) commentRef.current?.focus({ preventScroll: true });
  }, [revising]);

  if (error || (state !== null && state.latestVersion === 0)) return null;

  const frameSrc = state ? mockupUrl(sessionId, state.latestVersion, state.selectedTheme) : '';
  const themeLabel = state?.themeDelegated
    ? t(lang, 'mockupArchive.themeDelegated')
    : (state?.themes.find((theme) => theme.id === state.selectedTheme)?.name ?? null);
  // 상한으로 멈춘 판을 「승인하신 화면」이라 부르면 거짓이다 — 무엇 때문에 멈췄는지 말한다 (원칙 5)
  const lede =
    state?.convergence === 'escalated'
      ? t(lang, 'mockupArchive.ledeEscalated')
      : t(lang, 'mockupArchive.lede');

  function submitRevision(): void {
    const text = comment.trim();
    if (!state || !text || !onRevise) return;
    setComment('');
    setRevising(false);
    onRevise(state.latestVersion, [{ text }]);
  }

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
          {themeLabel && state?.convergence !== 'escalated' && (
            <Badge variant="secondary" className="text-[11px]">
              {themeLabel}
            </Badge>
          )}
          {onRevise && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={submitting}
              onClick={() => {
                setOpen(true);
                setRevising(true);
              }}
            >
              {t(lang, 'mockupArchive.revise')}
            </Button>
          )}
        </CardTitle>
        <CardDescription>{lede}</CardDescription>
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
              {revising && onRevise && (
                <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
                  <p className="text-sm font-medium">{t(lang, 'mockupArchive.reviseTitle')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(lang, 'mockupArchive.reviseHint')}
                  </p>
                  <Textarea
                    ref={commentRef}
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setRevising(false);
                        setComment('');
                      }
                    }}
                    placeholder={t(lang, 'mockup.commentPlaceholder')}
                    disabled={submitting}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={submitting || !comment.trim()}
                      onClick={submitRevision}
                    >
                      {t(lang, 'mockupArchive.reviseSubmit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setRevising(false);
                        setComment('');
                      }}
                    >
                      {t(lang, 'mockupArchive.reviseCancel')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
