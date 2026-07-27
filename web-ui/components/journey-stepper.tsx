import { Badge } from '@/components/ui/badge';
import { t, type Lang } from '@/lib/i18n';
import { JOURNEY_STEPS } from '@/lib/stage';
import { cn } from '@/lib/utils';

interface Props {
  lang: Lang;
  current: number;
  /** 보류 등 현재 단계 위에 얹는 결과 표식 */
  note?: string;
}

/**
 * 전체 여정 스테퍼 (G-6, P-U4) — 모든 세션 화면 상단에 상주한다.
 * 미구현 단계(④⑤)도 노출하되 「준비 중」 표기 (#32 — 정직한 다음 예고).
 */
export function JourneyStepper({ lang, current, note }: Props) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1 gap-y-2"
      aria-label={t(lang, 'journey.aria')}
    >
      {JOURNEY_STEPS.map((step, i) => {
        const state = step.index < current ? 'done' : step.index === current ? 'current' : 'todo';
        return (
          <li key={step.index} className="flex items-center gap-1">
            {i > 0 && <span className="mx-1 h-px w-4 bg-border" aria-hidden />}
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
                state === 'current' && 'bg-primary text-primary-foreground font-medium',
                state === 'done' && 'text-foreground',
                state === 'todo' && 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full border text-[10px]',
                  state === 'current' && 'border-primary-foreground/40',
                  state === 'done' && 'border-primary bg-primary/10 text-primary',
                )}
                aria-hidden
              >
                {state === 'done' ? '✓' : step.index}
              </span>
              {t(lang, step.labelKey)}
              {'pending' in step && step.pending && (
                <Badge variant="outline" className="px-1 py-0 text-[9px] font-normal">
                  {t(lang, 'common.pending')}
                </Badge>
              )}
              {state === 'current' && note && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  {note}
                </Badge>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
