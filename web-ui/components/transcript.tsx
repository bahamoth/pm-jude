export interface TranscriptEntry {
  who: 'requester' | 'agent';
  text: string;
}

// 대화 이력 — 서버 전사가 진실 원천이고(원칙 7) 여기는 표시만 한다. 기본 접힘.
export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="group rounded-xl border bg-card px-4 py-3">
      <summary className="cursor-pointer select-none text-sm text-muted-foreground">
        지난 대화 {entries.length}건 <span className="group-open:hidden">펼치기</span>
        <span className="hidden group-open:inline">접기</span>
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
              {entry.who === 'requester' ? '나' : 'pm-jude'}
            </p>
            {entry.text}
          </div>
        ))}
      </div>
    </details>
  );
}
