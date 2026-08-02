'use client';

import { useEffect, useId, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';

/**
 * mermaid 렌더 (F3 v2.0, #70) — 텍스트 표기 다이어그램을 SVG로 그린다.
 * 번들에서 로드한다(외부 CDN 없음 — F4 목업 호스팅과 같은 정신). securityLevel 'strict'로
 * 클릭 콜백·외부 링크를 차단한다: 다이어그램 본문은 LLM 재생성 산출물이다.
 * 렌더 실패는 침묵하지 않는다 — 실패 사실과 함께 mermaid 원문을 코드 블록으로 보여준다.
 */

let mermaidModule: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(): Promise<typeof import('mermaid').default> {
  mermaidModule ??= import('mermaid').then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // 앱은 라이트 고정(globals.css의 .dark는 토글 경로가 없다) — neutral이 카드 배경에 맞는다
      theme: 'neutral',
      fontFamily: 'inherit',
    });
    return mod.default;
  });
  return mermaidModule;
}

export function MermaidDiagram({ lang, source }: { lang: Lang; source: string }) {
  const reactId = useId();
  // 결과를 소스와 함께 담는다 — 소스가 바뀌면 비교가 스켈레톤으로 되돌리므로,
  // 이펙트 서두의 동기 리셋 setState가 필요 없다 (react-hooks/set-state-in-effect)
  const [rendered, setRendered] = useState<{
    source: string;
    svg: string | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    // mermaid.render의 id는 DOM id로 쓰인다 — useId의 콜론을 제거한다
    const renderId = `mmd-${reactId.replaceAll(':', '')}`;
    loadMermaid()
      .then((mermaid) => mermaid.render(renderId, source))
      .then((result) => {
        if (alive) setRendered({ source, svg: result.svg, failed: false });
      })
      .catch(() => {
        if (alive) setRendered({ source, svg: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [reactId, source]);

  const current = rendered?.source === source ? rendered : null;
  const svg = current?.svg ?? null;
  const failed = current?.failed ?? false;

  if (failed) {
    return (
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground">{t(lang, 'diagram.renderFailed')}</p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          <code>{source}</code>
        </pre>
      </div>
    );
  }
  if (svg === null) {
    return <div className="min-h-24 animate-pulse rounded-md bg-muted" aria-hidden />;
  }
  return (
    // SVG는 securityLevel 'strict'가 소독한 mermaid 출력이다
    <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
