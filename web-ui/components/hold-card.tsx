'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { t, type Lang } from '@/lib/i18n';
import type { SlotView } from '@/lib/types';

interface Props {
  lang: Lang;
  slots: SlotView[];
  submitting: boolean;
  /** 키 입력 한 번 = Jude에게 소리 한 번 */
  onType?: () => void;
  onResume: (text: string) => void;
}

/**
 * 보류(정보 부족) 화면 (G-4) — 무엇이 부족했는지 보여주고, 「이어서 보태기」가 주 경로다.
 * 입력하면 같은 세션이 자동 재개된다(#30) — 지금까지의 대화·정리는 그대로 이어진다.
 */
export function HoldCard({ lang, slots, submitting, onType, onResume }: Props) {
  const [text, setText] = useState('');
  const missing = slots.filter((slot) => slot.state === 'unfilled');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t(lang, 'hold.title')}</CardTitle>
        <CardDescription>{t(lang, 'hold.lede')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t(lang, 'hold.missing', { labels: missing.map((slot) => slot.label).join(', ') })}
          </p>
        )}
        <Textarea
          rows={3}
          placeholder={t(lang, 'hold.placeholder')}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onType?.();
          }}
        />
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={submitting || text.trim().length === 0}
          onClick={() => onResume(text.trim())}
        >
          {t(lang, 'hold.resume')}
        </Button>
      </CardFooter>
    </Card>
  );
}
