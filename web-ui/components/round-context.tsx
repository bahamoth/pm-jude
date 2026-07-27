import { Card, CardContent } from '@/components/ui/card';
import { t, type Lang } from '@/lib/i18n';
import type { SlotView } from '@/lib/types';

/**
 * 라운드 맥락 카드 (G-2) — 왕복이 축적임을 보여준다: 정리된 것과 남은 것.
 * 진행 표시는 카운트형(M-5) — 라운드 수는 동적이므로 비율바를 쓰지 않는다.
 */
export function RoundContext({ lang, slots }: { lang: Lang; slots: SlotView[] }) {
  const filled = slots.filter((slot) => slot.state === 'filled' || slot.state === 'promoted');
  const remaining = slots.filter((slot) => slot.state === 'unfilled');
  if (filled.length === 0) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="grid gap-2 py-4 text-sm">
        <p className="font-medium">{t(lang, 'round.title')}</p>
        <ul className="grid gap-1 text-muted-foreground">
          {filled.map((slot) => (
            <li key={slot.slotKey} className="flex gap-2">
              <span className="text-primary">✓</span>
              <span>
                <span className="text-foreground">{slot.label}</span>
                {slot.value && <span> — {slot.value}</span>}
                {slot.state === 'promoted' && <span> {t(lang, 'round.promoted')}</span>}
              </span>
            </li>
          ))}
        </ul>
        {remaining.length > 0 && (
          <p className="text-muted-foreground">
            {t(lang, 'round.remaining', {
              count: remaining.length,
              labels: remaining.map((slot) => slot.label).join(', '),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
