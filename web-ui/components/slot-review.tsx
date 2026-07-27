'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { t, type Lang } from '@/lib/i18n';
import type { SlotView } from '@/lib/types';

interface Props {
  lang: Lang;
  slots: SlotView[];
  submitting: boolean;
  onConfirm: (slotKey: string) => void;
  onCorrect: (slotKey: string, text: string) => void;
}

/**
 * 슬롯 단위 요청자 확인 (G-3, F3 — 원칙 7 번역 무결성 장치).
 * 정리된 값을 슬롯 단위·요청자 언어로 확인한다. 「아니에요」는 해당 슬롯만 정정한다.
 */
export function SlotReview({ lang, slots, submitting, onConfirm, onCorrect }: Props) {
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const reviewable = slots.filter((slot) => slot.state === 'filled');
  const promoted = slots.filter((slot) => slot.state === 'promoted');
  if (reviewable.length === 0 && promoted.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t(lang, 'slots.title')}</CardTitle>
        <CardDescription>{t(lang, 'slots.lede')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {reviewable.map((slot, i) => (
          <div key={slot.slotKey} className="grid gap-2">
            {i > 0 && <Separator />}
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm">
                <p className="font-medium">{slot.label}</p>
                <p className="text-muted-foreground">{slot.value ?? '—'}</p>
              </div>
              {slot.confirmedByRequester ? (
                <Badge variant="secondary">{t(lang, 'slots.confirmed')}</Badge>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => onConfirm(slot.slotKey)}
                  >
                    {t(lang, 'slots.yes')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={submitting}
                    onClick={() => {
                      setCorrecting(correcting === slot.slotKey ? null : slot.slotKey);
                      setText('');
                    }}
                  >
                    {t(lang, 'slots.no')}
                  </Button>
                </div>
              )}
            </div>
            {correcting === slot.slotKey && (
              <div className="grid gap-2">
                <Textarea
                  rows={2}
                  autoFocus
                  placeholder={t(lang, 'slots.correctPlaceholder')}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <Button
                  size="sm"
                  className="justify-self-end"
                  disabled={submitting || text.trim().length === 0}
                  onClick={() => {
                    onCorrect(slot.slotKey, text.trim());
                    setCorrecting(null);
                  }}
                >
                  {t(lang, 'slots.sendCorrection')}
                </Button>
              </div>
            )}
          </div>
        ))}
        {promoted.length > 0 && (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">
              {t(lang, 'slots.promotedTitle', { count: promoted.length })}
            </p>
            {promoted.map((slot) => (
              <p key={slot.slotKey}>
                · {slot.label} — {t(lang, 'slots.promotedNote')}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
