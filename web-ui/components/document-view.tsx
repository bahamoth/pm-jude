'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { InlineEditor } from '@/components/inline-editor';
import { Textarea } from '@/components/ui/textarea';
import { anchorPosition, type AnchorResult } from '@/lib/anchor';
import {
  commonArrayPath,
  readSelectionPaths,
  selectionFromElement,
  type DocSelection,
} from '@/lib/doc-selection';
import type { DocLine } from '@/lib/document';
import { t, type Lang } from '@/lib/i18n';

/** 지시가 바꿀 블록의 표시 — 드래그 범위와 실제 대상이 다를 수 있으므로 눈에 보여야 한다. */
const TARGET_CLASS = 'rounded bg-primary/10 ring-1 ring-primary/40';

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
  const [text, setText] = useState('');
  // 인플레이스 편집 중인 주소 — 그 줄이 편집기로 바뀐다 (#66 UX)
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const correctable = onCorrect !== undefined && lines.some((line) => line.path);

  const open = (picked: DocSelection | null) => {
    if (!picked) return;
    setSelection(picked);
    setText('');
  };
  const close = () => {
    setSelection(null);
    setAnchor(null);
    setText('');
  };
  /**
   * 그 자리에서 고치기 — 팝오버를 닫고 대상을 편집기로 바꾼다.
   * 한 배열의 형제 항목들이면 그 배열 전체를 줄 단위로 편집한다(줄이 늘면 추가, 줄면 삭제).
   */
  const startInlineEdit = (paths: readonly string[]) => {
    const arrayPath = commonArrayPath(paths);
    close();
    setEditingPath(arrayPath ?? paths[0] ?? null);
  };
  const commitInline = (path: string, value: string) => {
    setEditingPath(null);
    onCorrect?.({ mode: 'edit', paths: [path], text: value });
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
  /** 더블클릭은 그 자리에서 바로 고치기다 — 지시할 필요가 없는 사람의 경로. */
  const editLine = (event: React.MouseEvent<HTMLElement>) => {
    if (!correctable) return;
    // 드래그로 형제 항목을 여럿 잡아둔 상태면 그 범위를 함께 편집한다
    const picked = readSelectionPaths(bodyRef.current);
    if (picked && commonArrayPath(picked.paths)) {
      startInlineEdit(picked.paths);
      return;
    }
    const path = event.currentTarget.dataset.docPath;
    if (path) startInlineEdit([path]);
  };

  // 팝오버를 선택 지점 옆에 붙인다 — 고칠 곳과 입력하는 곳이 멀면 무엇을 고치는지 놓친다.
  // 좌표는 viewport 기준이고 position: fixed다 — 문서 레이아웃과 스크롤 영역을 건드리지 않는다.
  useLayoutEffect(() => {
    if (!selection) return;
    const size = popoverRef.current?.getBoundingClientRect();
    setAnchor(
      anchorPosition(
        selection.rect,
        { width: size?.width ?? 340, height: size?.height ?? 200 },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [selection]);

  // 닫는 길은 셋이다 — 명시적 취소 버튼, ESC, 그리고 바깥 클릭. 어느 하나만 두면 갇힌다.
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (popoverRef.current?.contains(target)) return; // 팝오버 안의 클릭은 조작이다
      close();
    };
    // fixed 좌표는 스크롤하면 낡는다 — 따라다니게 만드는 대신 닫는다(선택 맥락도 흐려진다)
    const onScrollOrResize = () => close();
    document.addEventListener('keydown', onKey);
    // 캡처 단계에서 받는다 — 문서 본문의 클릭 핸들러가 먼저 새 선택을 열어버리지 않게
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [selection]);
  // 포커스는 위치가 정해진 뒤에 준다. preventScroll이 없으면 브라우저가 입력창을 보이게
  // 하려고 문서를 스크롤한다 — 문서 하단에서 특히 크게 튄다.
  useEffect(() => {
    if (selection && anchor) inputRef.current?.focus({ preventScroll: true });
  }, [selection, anchor]);

  const submit = () => {
    if (!selection || !text.trim()) return;
    onCorrect?.({
      mode: 'instruct',
      paths: selection.paths,
      text: text.trim(),
      ...(selection.quotedText ? { quotedText: selection.quotedText } : {}),
    });
    close();
  };

  // 지시가 바꿀 범위 (#66 UX) — 드래그는 문단 절반을 잡아도 대상은 그 항목 전체다.
  // 그 차이를 문구로 설명하지 않고 하이라이트로 보여준다.
  const targetPaths = new Set(selection?.paths ?? []);
  // 선택이 블록보다 작았는가 — 그렇다면 "왜 전체가 대상인지" 한 줄 안내가 필요하다
  const partialPick =
    selection !== null &&
    selection.quotedText.length > 0 &&
    lines.some(
      (line) =>
        line.path && targetPaths.has(line.path) && line.text.trim() !== selection.quotedText,
    );

  // 배열을 편집 중이면 그 항목 줄들 — 편집기 하나로 합쳐 보여준다
  const groupLines =
    editingPath && !editingPath.endsWith(']') && !/\]\.[A-Za-z]+$/.test(editingPath)
      ? lines.filter((line) => line.path?.startsWith(`${editingPath}[`))
      : [];

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
        className="grid gap-2.5 text-[15px] leading-relaxed"
      >
        {fullyPromoted && (
          <div className="rounded-lg border border-dashed p-3 text-sm">
            <p className="font-medium">{t(lang, 'doc.fullyPromotedTitle')}</p>
            <p className="text-muted-foreground">{t(lang, 'doc.fullyPromotedNote')}</p>
          </div>
        )}
        {lines.map((line, i) => {
          // 편집 중인 대상은 그 자리에서 편집기가 된다 (#66 UX).
          // 배열을 편집하면 그 항목 줄들이 편집기 하나로 합쳐진다 — 줄이 늘면 추가, 줄면 삭제.
          if (editingPath && line.path) {
            if (line.path === editingPath) {
              return (
                <span key={i} className={line.kind === 'sub' ? 'block pl-6' : 'block'}>
                  <InlineEditor
                    lang={lang}
                    initial={line.text}
                    submitting={submitting}
                    onCommit={(value) => commitInline(editingPath, value)}
                    onCancel={() => setEditingPath(null)}
                  />
                </span>
              );
            }
            if (groupLines.length > 0 && line.path === groupLines[0]?.path) {
              return (
                <span key={i} className="block">
                  <InlineEditor
                    lang={lang}
                    initial={groupLines.map((entry) => entry.text).join('\n')}
                    submitting={submitting}
                    onCommit={(value) => commitInline(editingPath, value)}
                    onCancel={() => setEditingPath(null)}
                  />
                </span>
              );
            }
            // 같은 배열의 나머지 줄은 편집기에 흡수됐다
            if (groupLines.some((entry) => entry.path === line.path)) return null;
          }
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
                <p
                  key={i}
                  data-doc-path={line.path}
                  onClick={pickLine}
                  onDoubleClick={editLine}
                  className={line.path && targetPaths.has(line.path) ? TARGET_CLASS : undefined}
                >
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
                  onDoubleClick={editLine}
                  className={`flex gap-2 pl-1${correctable && line.path ? ' cursor-pointer rounded hover:bg-muted/60' : ''}${line.path && targetPaths.has(line.path) ? ` ${TARGET_CLASS}` : ''}`}
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
                  onDoubleClick={editLine}
                  className={`pl-6 text-sm${correctable && line.path ? ' cursor-pointer rounded hover:bg-muted/60' : ''}${line.path && targetPaths.has(line.path) ? ` ${TARGET_CLASS}` : ''}`}
                >
                  – {line.text}
                </p>
              );
            case 'gwt':
              return (
                <p
                  key={i}
                  data-doc-path={line.path}
                  className={`ml-6 rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground${line.path && targetPaths.has(line.path) ? ` ${TARGET_CLASS}` : ''}`}
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
            // 좌표는 렌더 후에야 잰다 — 그 사이 (0,0)에 보이면 화면이 튀고 포커스가 위로 끌려간다.
            // DOM에는 두어 크기를 재고, 위치가 정해질 때까지만 숨긴다.
            className={`fixed z-50 w-[min(22rem,calc(100vw-1rem))] rounded-lg border bg-popover p-3 shadow-lg${
              anchor ? '' : ' invisible'
            }`}
            // 팝오버 안의 클릭·선택이 바깥의 선택 캡처를 다시 트리거하지 않게 막는다
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge variant="secondary" className="text-[11px]">
                {t(lang, 'doc.correctTargetCount', { count: selection.paths.length })}
              </Badge>
              <button
                type="button"
                onClick={close}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t(lang, 'doc.correctCancel')}
              </button>
            </div>

            {/* 팝오버는 지시 전용이다 — 직접 고치기는 더블클릭으로 그 자리에서 한다 */}
            <div className="grid gap-2">
              {partialPick && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  {t(lang, 'doc.correctPartialNote')}
                </p>
              )}
              {selection.quotedText && (
                <p className="line-clamp-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  <span className="font-medium">{t(lang, 'doc.correctQuotedLabel')}</span> “
                  {selection.quotedText}”
                </p>
              )}
              <Textarea
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  // 지시도 길어질 수 있다 — 내용만큼 자라고 스크롤바는 두지 않는다
                  const node = e.currentTarget;
                  node.style.height = 'auto';
                  node.style.height = `${String(node.scrollHeight)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t(lang, 'doc.correctInstructPlaceholder')}
                rows={2}
                className="resize-none overflow-hidden text-sm"
              />
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" disabled={submitting || !text.trim()} onClick={submit}>
                  {t(lang, 'doc.correctApply')}
                </Button>
                <button
                  type="button"
                  onClick={() => startInlineEdit(selection.paths)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t(lang, 'doc.correctModeEditInline')}
                </button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
