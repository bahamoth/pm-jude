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
import type { SlotView } from '@/lib/types';

interface Props {
  slots: SlotView[];
  submitting: boolean;
  onResume: (text: string) => void;
}

/**
 * 보류(정보 부족) 화면 (G-4) — 무엇이 부족했는지 보여주고, 「이어서 보태기」가 주 경로다.
 * 입력하면 같은 세션이 자동 재개된다(#30) — 지금까지의 대화·정리는 그대로 이어진다.
 */
export function HoldCard({ slots, submitting, onResume }: Props) {
  const [text, setText] = useState('');
  const missing = slots.filter((slot) => slot.state === 'unfilled');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">지금은 보류로 정리했어요</CardTitle>
        <CardDescription>
          답변으로 정리하기에 정보가 부족했어요. 내용을 보태면 이 요청이 그 자리에서 다시 진행됩니다
          — 지금까지 답한 내용은 그대로 남아 있어요.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {missing.length > 0 && (
          <p className="text-sm text-muted-foreground">
            부족했던 것: {missing.map((slot) => slot.label).join(', ')}
          </p>
        )}
        <Textarea
          rows={3}
          placeholder="보탤 내용을 적어 주세요 — 예: 어떤 팀이 쓰는지, 어떤 문제를 풀고 싶은지"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          disabled={submitting || text.trim().length === 0}
          onClick={() => onResume(text.trim())}
        >
          이어서 보태기
        </Button>
      </CardFooter>
    </Card>
  );
}
