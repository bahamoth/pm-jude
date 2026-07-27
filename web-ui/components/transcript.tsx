import { t, type Lang } from '@/lib/i18n';

export interface TranscriptEntry {
  who: 'requester' | 'agent';
  text: string;
}

// 대화 이력 — 서버 세션 저장소의 원문 전사(상시 보존, US-11)를 표시만 한다. 기본 접힘.
// 전사는 참고용이며 구현 근거는 requirements 문서뿐이다(원칙 7 — 문서 단일 진실 원천).
export function Transcript({ lang, entries }: { lang: Lang; entries: TranscriptEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="group rounded-xl border bg-card px-4 py-3">
      <summary className="cursor-pointer select-none text-sm text-muted-foreground">
        {t(lang, 'transcript.summary', { count: entries.length })}{' '}
        <span className="group-open:hidden">{t(lang, 'transcript.expand')}</span>
        <span className="hidden group-open:inline">{t(lang, 'transcript.collapse')}</span>
      </summary>
      <div className="mt-3 grid gap-2">
        {entries.map((entry, i) => (
          <div
            key={i}
            className={
              entry.who === 'requester'
                ? 'ml-10 whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm'
                : 'mr-10 whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm'
            }
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t(lang, entry.who === 'requester' ? 'transcript.me' : 'transcript.jude')}
            </p>
            {entry.text}
          </div>
        ))}
      </div>
    </details>
  );
}
