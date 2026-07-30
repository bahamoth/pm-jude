'use client';

import { useEffect, useRef, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';

interface Props {
  lang: Lang;
  /** 시작 값 — 빈 칸이 아니라 지금 문장에서 시작한다. */
  initial: string;
  submitting?: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

/**
 * 그 자리에서 고치는 편집기 (#66 UX) — 팝오버 안이 아니라 문서의 그 줄이 편집 가능해진다.
 *
 * 고칠 문장과 쓰는 자리가 같아야 무엇을 고치는 중인지 놓치지 않는다. 높이는 내용에 맞춰
 * 늘어나고(스코프 항목은 여러 줄이 흔하다), Enter로 확정·Shift+Enter로 줄바꿈·ESC로 취소한다.
 */
export function InlineEditor({ lang, initial, submitting, onCommit, onCancel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(initial);

  // 열리면 바로 쓸 수 있게 — 커서는 끝에 둔다(고치려는 것은 대개 문장 뒷부분이다)
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  // 내용에 맞춰 높이를 잡는다 — 스크롤바가 생기면 문장 전체가 안 보인다
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${String(node.scrollHeight)}px`;
  }, [text]);

  const commit = () => {
    const value = text.trim();
    if (!value || value === initial.trim()) {
      onCancel();
      return;
    }
    onCommit(value);
  };

  /**
   * 바깥을 누르면 **확정**한다 — 인플레이스 편집의 관례이고, 여기서 취소하면 방금 쓴 문장을
   * 조용히 버리는 셈이 된다. 고친 게 없으면 그냥 닫는다. 되돌리기는 문서 버전이 맡는다.
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (wrapRef.current?.contains(target)) return;
      commit();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  return (
    <span ref={wrapRef} className="block">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        rows={1}
        disabled={submitting}
        className="w-full resize-none rounded-md border border-primary/60 bg-background px-2 py-1 text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={commit}
          disabled={submitting}
          className="font-medium text-primary hover:underline disabled:opacity-50"
        >
          {t(lang, 'doc.inlineCommit')}
        </button>
        <button type="button" onClick={onCancel} className="hover:text-foreground">
          {t(lang, 'doc.correctCancel')}
        </button>
        <span>{t(lang, 'doc.inlineHint')}</span>
      </span>
    </span>
  );
}
