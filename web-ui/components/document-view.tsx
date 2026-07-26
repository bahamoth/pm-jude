import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { parseDocumentText } from '@/lib/document';

// requirements 문서 열람 (US-9·10) — 코어가 게시한 문서 텍스트를 구조대로 표시한다.
export function DocumentView({ text }: { text: string }) {
  const lines = parseDocumentText(text);

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3">
        <CardTitle className="text-lg">requirements 문서</CardTitle>
        <Badge>정제 완료</Badge>
      </CardHeader>
      <CardContent className="grid gap-2.5 text-[15px] leading-relaxed">
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
                <p key={i}>
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
                <p key={i} className="flex gap-2 pl-1">
                  <span className="text-primary">•</span>
                  <span>{line.text}</span>
                </p>
              );
            case 'sub':
              return (
                <p key={i} className="pl-6 text-sm">
                  – {line.text}
                </p>
              );
            case 'gwt':
              return (
                <p
                  key={i}
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
