'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import type { SlotView } from '@/lib/types';

interface Props {
  slots: SlotView[];
  submitting: boolean;
  onConfirm: (slotKey: string) => void;
  onCorrect: (slotKey: string, text: string) => void;
}

/**
 * 슬롯 단위 요청자 확인 (G-3, F3 — 원칙 7 번역 무결성 장치).
 * 정리된 값을 슬롯 단위·요청자 언어로 확인한다. 「아니에요」는 해당 슬롯만 정정한다.
 */
export function SlotReview({ slots, submitting, onConfirm, onCorrect }: Props) {
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [text, setText] = useState('');
  const reviewable = slots.filter((slot) => slot.state === 'filled');
  const promoted = slots.filter((slot) => slot.state === 'promoted');
  if (reviewable.length === 0 && promoted.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">정리한 내용이 맞는지 확인해 주세요</CardTitle>
        <CardDescription>항목별로 확인해 주시면 문서의 정확도가 올라가요.</CardDescription>
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
                <Badge variant="secondary">확인됨 ✓</Badge>
              ) : (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => onConfirm(slot.slotKey)}
                  >
                    맞아요
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
                    아니에요
                  </Button>
                </div>
              )}
            </div>
            {correcting === slot.slotKey && (
              <div className="grid gap-2">
                <Textarea
                  rows={2}
                  autoFocus
                  placeholder="실제로는 어떤가요? 바로잡아 주세요"
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
                  정정 보내기
                </Button>
              </div>
            )}
          </div>
        ))}
        {promoted.length > 0 && (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">
              개발팀이 확인할 항목 {promoted.length}건
            </p>
            {promoted.map((slot) => (
              <p key={slot.slotKey}>
                · {slot.label} — 당신이 답하지 않아도 됩니다. 개발팀 검토에서 확정돼요.
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
