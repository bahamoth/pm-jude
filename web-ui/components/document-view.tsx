'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { anchorPosition, type AnchorResult } from '@/lib/anchor';
import { readSelectionPaths, selectionFromElement, type DocSelection } from '@/lib/doc-selection';
import type { DocLine } from '@/lib/document';
import { t, type Lang } from '@/lib/i18n';

export interface DocumentCorrectionRequest {
  mode: 'edit' | 'instruct';
  paths: string[];
  text: string;
  quotedText?: string;
}

interface Props {
  lang: Lang;
  /** 표시 라인 — 저장 구조체(정본) 또는 레거시 텍스트 파서가 만든다 (#53, lib/document). */
  lines: DocLine[];
  /** 문서 vN — 슬롯 정정·부분 교정마다 올라간다 (G-11, #66). */
  version: number;
  /** 전 슬롯이 승격으로 통과한 문서인지 — 정직한 구분 표시 (G-11, #28 S-5). */
  fullyPromoted: boolean;
  /** 부분 교정 (#66) — 없으면 열람 전용(레거시 텍스트 경로는 주소가 없다). */
  onCorrect?: (request: DocumentCorrectionRequest) => void;
  submitting?: boolean;
}

// requirements 문서 열람 (US-9·10) — 문서를 구조대로 표시한다.
// 교정 대상 라인에는 data-doc-path로 요소 주소를 심는다 (#66, ADR-0016) — 드래그 선택이
// 선택 범위가 걸친 주소를 이 속성에서 읽어 부분 정정의 대상으로 삼는다.
/** 화면에 그려진 그 줄의 현재 텍스트 — 직접 편집은 빈 칸이 아니라 지금 문장에서 시작한다. */
function currentTextOf(container: HTMLElement | null, path: string | undefined): string {
  if (!container || !path) return '';
  const element = container.querySelector<HTMLElement>(`[data-doc-path="${path}"]`);
  return element?.textContent?.replace(/^•\s*/, '').replace(/^–\s*/, '').trim() ?? '';
}

export function DocumentView({
  lang,
  lines,
  version,
  fullyPromoted,
  onCorrect,
  submitting,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [anchor, setAnchor] = useState<AnchorResult | null>(null);
  // 선택 직후에는 모드를 고르는 상태다 — 무엇으로 고칠지 정하기 전에 입력창을 띄우지 않는다
  const [mode, setMode] = useState<'instruct' | 'edit' | null>(null);
  const [text, setText] = useState('');
  const correctable = onCorrect !== undefined && lines.some((line) => line.path);

  const open = (picked: DocSelection | null, presetText = '') => {
    if (!picked) return;
    setSelection(picked);
    setMode(null);
    setText(presetText);
  };
  const close = () => {
    setSelection(null);
    setAnchor(null);
    setMode(null);
    setText('');
  };

  // 드래그 선택이든 항목 클릭이든 같은 경로다 — 클릭은 한 요소를 고른 선택이다 (#66)
  const captureSelection = () => {
    if (!correctable) return;
    open(readSelectionPaths(bodyRef.current));
  };
  const pickLine = (event: React.MouseEvent<HTMLElement>) => {
    if (!correctable) return;
    // 드래그로 잡은 선택이 있으면 그쪽이 우선이다 — 클릭이 범위 선택을 덮지 않게
    if (!window.getSelection()?.isCollapsed) return;
    open(selectionFromElement(event.currentTarget));
  };

  // 팝오버를 선택 지점 옆에 붙인다 — 고칠 곳과 입력하는 곳이 멀면 무엇을 고치는지 놓친다
  useLayoutEffect(() => {
    if (!selection || !bodyRef.current) return;
    const box = bodyRef.current.getBoundingClientRect();
    const size = popoverRef.current?.getBoundingClientRect();
    setAnchor(
      anchorPosition(
        selection.rect,
        { top: box.top, left: box.left, width: box.width, height: box.height },
        { width: size?.width ?? 340, height: size?.height ?? 180 },
        window.innerHeight,
      ),
    );
  }, [selection, mode]);

  // ESC로 닫고, 모드를 고르면 바로 입력에 커서가 간다 — 클릭 한 번을 아낀다
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selection]);
  useEffect(() => {
    if (mode) inputRef.current?.focus();
  }, [mode]);

  const multiEdit = mode === 'edit' && (selection?.paths.length ?? 0) > 1;
  const submit = () => {
    if (!selection || !mode || !text.trim() || multiEdit) return;
    onCorrect?.({
      mode,
      paths: selection.paths,
      text: text.trim(),
      ...(selection.quotedText ? { quotedText: selection.quotedText } : {}),
    });
    close();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <CardTitle className="text-lg">{t(lang, 'doc.title')}</CardTitle>
        <Badge>{t(lang, 'doc.badge')}</Badge>
        {version > 0 && (
          <Badge variant="outline" className="font-mono text-[11px]">
            {t(lang, 'doc.version', { version })}
          </Badge>
        )}
      </CardHeader>
      <CardContent
        ref={bodyRef}
        onMouseUp={captureSelection}
        onTouchEnd={captureSelection}
        className="relative grid gap-2.5 text-[15px] leading-relaxed"
      >
        {fullyPromoted && (
          <div className="rounded-lg border border-dashed p-3 text-sm">
            <p className="font-medium">{t(lang, 'doc.fullyPromotedTitle')}</p>
            <p className="text-muted-foreground">{t(lang, 'doc.fullyPromotedNote')}</p>
          </div>
        )}
        {lines.map((line, i) => {
          switch (line.kind) {
            case 'title':
              return (
                <p
                  key={i}
                  className="font-mono text-xs uppercase tracking-widest text-muted-foreground"
                >
                  {line.text}
                </p>
              );
            case 'field':
              return (
                <p key={i} data-doc-path={line.path} onClick={pickLine}>
                  <span className="font-semibold">{line.label}</span>
                  <span className="text-muted-foreground"> — </span>
                  {line.text}
                </p>
              );
            case 'section':
              return (
                <div key={i} className="mt-2">
                  <Separator className="mb-3" />
                  <h3 className="font-semibold">{line.label}</h3>
                  {line.text && <p className="text-sm text-muted-foreground">{line.text}</p>}
                </div>
              );
            case 'bullet':
              return (
                <p
                  key={i}
                  data-doc-path={line.path}
                  onClick={pickLine}
                  className={`flex gap-2 pl-1${correctable && line.path ? ' cursor-pointer rounded hover:bg-muted/60' : ''}`}
                >
                  <span className="text-primary">•</span>
                  <span>{line.text}</span>
                </p>
              );
            case 'sub':
              return (
                <p
                  key={i}
                  data-doc-path={line.path}
                  onClick={pickLine}
                  className={`pl-6 text-sm${correctable && line.path ? ' cursor-pointer rounded hover:bg-muted/60' : ''}`}
                >
                  – {line.text}
                </p>
              );
            case 'gwt':
              return (
                <p
                  key={i}
                  data-doc-path={line.path}
                  className="ml-6 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground"
                >
                  {line.text}
                </p>
              );
            case 'note':
              return (
                <p key={i} className="mt-2 text-xs text-muted-foreground">
                  {line.text}
                </p>
              );
            default:
              return <p key={i}>{line.text}</p>;
          }
        })}

        {/* 부분 교정 (#66) — 팝오버가 선택 지점 옆에 뜬다. 완주·종결 뒤에도 열려 있다 */}
        {correctable && selection === null && (
          <p className="mt-2 text-xs text-muted-foreground">{t(lang, 'doc.correctHint')}</p>
        )}
        {correctable && selection && (
          <div
            ref={popoverRef}
            style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0 }}
            className="absolute z-20 w-[min(22rem,calc(100%-1rem))] rounded-lg border bg-popover p-3 shadow-lg"
            // 팝오버 안의 클릭·선택이 바깥의 선택 캡처를 다시 트리거하지 않게 막는다
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge variant="secondary" className="text-[11px]">
                {t(lang, 'doc.correctSelected', { count: selection.paths.length })}
              </Badge>
              <button
                type="button"
                onClick={close}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t(lang, 'doc.correctCancel')}
              </button>
            </div>

            {mode === null ? (
              // 무엇으로 고칠지 먼저 고른다 — 선택 바로 옆에서 두 경로가 갈린다
              <div className="grid gap-1.5">
                <Button size="sm" className="justify-start" onClick={() => setMode('instruct')}>
                  {t(lang, 'doc.correctModeInstruct')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="justify-start"
                  disabled={selection.paths.length > 1}
                  onClick={() => {
                    // 직접 고치기는 현재 문장을 그대로 띄워 놓고 손보게 한다
                    setMode('edit');
                    setText(currentTextOf(bodyRef.current, selection.paths[0]));
                  }}
                >
                  {t(lang, 'doc.correctModeEdit')}
                </Button>
                {selection.paths.length > 1 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t(lang, 'doc.correctMultiEditNote')}
                  </p>
                )}
              </div>
            ) : (
              <div className="grid gap-2">
                {mode === 'instruct' && selection.quotedText && (
                  <p className="line-clamp-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                    “{selection.quotedText}”
                  </p>
                )}
                <Textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    // 지시는 한 줄이 보통이라 Enter로 보낸다. 직접 편집은 줄바꿈이 필요해 ⌘/Ctrl+Enter.
                    const send = mode === 'instruct' ? !e.shiftKey : e.metaKey || e.ctrlKey;
                    if (e.key === 'Enter' && send) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder={t(
                    lang,
                    mode === 'edit'
                      ? 'doc.correctEditPlaceholder'
                      : 'doc.correctInstructPlaceholder',
                  )}
                  rows={mode === 'edit' ? 5 : 2}
                  className="text-sm"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={submitting || !text.trim()} onClick={submit}>
                    {t(lang, 'doc.correctApply')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode(null);
                      setText('');
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t(lang, 'doc.correctBack')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
