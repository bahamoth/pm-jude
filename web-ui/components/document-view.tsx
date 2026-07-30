import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { DocLine } from '@/lib/document';
import { t, type Lang } from '@/lib/i18n';

interface Props {
  lang: Lang;
  /** 표시 라인 — 저장 구조체(정본) 또는 레거시 텍스트 파서가 만든다 (#53, lib/document). */
  lines: DocLine[];
  /** 문서 vN — 슬롯 정정 재생성마다 올라간다 (G-11). */
  version: number;
  /** 전 슬롯이 승격으로 통과한 문서인지 — 정직한 구분 표시 (G-11, #28 S-5). */
  fullyPromoted: boolean;
}

// requirements 문서 열람 (US-9·10) — 문서를 구조대로 표시한다.
// 교정 대상 라인에는 data-doc-path로 요소 주소를 심는다 (#66, ADR-0016) — 드래그 선택이
// 선택 범위가 걸친 주소를 이 속성에서 읽어 부분 정정의 대상으로 삼는다.
export function DocumentView({ lang, lines, version, fullyPromoted }: Props) {
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
      <CardContent className="grid gap-2.5 text-[15px] leading-relaxed">
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
                <p key={i} data-doc-path={line.path}>
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
                <p key={i} data-doc-path={line.path} className="flex gap-2 pl-1">
                  <span className="text-primary">•</span>
                  <span>{line.text}</span>
                </p>
              );
            case 'sub':
              return (
                <p key={i} data-doc-path={line.path} className="pl-6 text-sm">
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
      </CardContent>
    </Card>
  );
}
