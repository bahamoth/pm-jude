'use client';

import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { readSelectionPaths } from '@/lib/doc-selection';
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
export function DocumentView({
  lang,
  lines,
  version,
  fullyPromoted,
  onCorrect,
  submitting,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ paths: string[]; quotedText: string } | null>(null);
  const [mode, setMode] = useState<'instruct' | 'edit'>('instruct');
  const [text, setText] = useState('');
  const correctable = onCorrect !== undefined && lines.some((line) => line.path);

  // 드래그 선택이든 항목 클릭이든 같은 경로로 모은다 — 클릭은 한 요소를 고른 선택이다 (#66)
  const captureSelection = () => {
    if (!correctable) return;
    const picked = readSelectionPaths(bodyRef.current);
    if (picked.paths.length === 0) return;
    setSelection(picked);
    setText('');
  };
  const pickLine = (path: string | undefined) => {
    if (!correctable || !path) return;
    setSelection({ paths: [path], quotedText: '' });
    setText('');
  };
  const close = () => {
    setSelection(null);
    setText('');
  };
  const multiEdit = mode === 'edit' && (selection?.paths.length ?? 0) > 1;

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
                <p key={i} data-doc-path={line.path} onClick={() => pickLine(line.path)}>
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
                  onClick={() => pickLine(line.path)}
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
                  onClick={() => pickLine(line.path)}
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

        {/* 부분 교정 (#66, ADR-0016) — 선택한 곳만 고친다. 완주·종결 뒤에도 열려 있다 */}
        {correctable && (
          <div className="mt-3 border-t pt-3">
            {selection === null ? (
              <p className="text-xs text-muted-foreground">{t(lang, 'doc.correctHint')}</p>
            ) : (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {t(lang, 'doc.correctSelected', { count: selection.paths.length })}
                  </Badge>
                  <Button
                    size="sm"
                    variant={mode === 'instruct' ? 'default' : 'outline'}
                    onClick={() => setMode('instruct')}
                  >
                    {t(lang, 'doc.correctModeInstruct')}
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === 'edit' ? 'default' : 'outline'}
                    onClick={() => setMode('edit')}
                  >
                    {t(lang, 'doc.correctModeEdit')}
                  </Button>
                </div>
                {selection.quotedText && (
                  <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    “{selection.quotedText.slice(0, 200)}”
                  </p>
                )}
                {/* 직접 고치기는 한 자리에 들어갈 문장을 쓰는 일이라 여러 곳에 동시 적용할 수 없다 */}
                {multiEdit ? (
                  <p className="text-xs text-destructive">{t(lang, 'doc.correctMultiEditNote')}</p>
                ) : (
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t(
                      lang,
                      mode === 'edit'
                        ? 'doc.correctEditPlaceholder'
                        : 'doc.correctInstructPlaceholder',
                    )}
                    rows={mode === 'edit' ? 4 : 2}
                  />
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={submitting || multiEdit || text.trim().length === 0}
                    onClick={() => {
                      onCorrect({
                        mode,
                        paths: selection.paths,
                        text: text.trim(),
                        ...(selection.quotedText ? { quotedText: selection.quotedText } : {}),
                      });
                      close();
                    }}
                  >
                    {t(lang, 'doc.correctApply')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={close}>
                    {t(lang, 'doc.correctCancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
