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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

export interface IntakeInput {
  name?: string;
  language: 'ko' | 'en';
  text: string;
}

// 간이 식별(이름·언어) + 요청 원문 — SSO·매직 링크 대체 (ADR-0007).
export function IntakeForm({ onSubmit }: { onSubmit: (input: IntakeInput) => void }) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'ko' | 'en'>('ko');
  const [text, setText] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">무엇을 만들어 드릴까요?</CardTitle>
        <CardDescription>
          요청을 남기면 몇 가지 확인 질문으로 내용을 정리해, 개발팀이 바로 착수할 수 있는
          requirements 문서로 만들어 드립니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="intake-name">이름 (선택)</Label>
          <Input
            id="intake-name"
            autoComplete="name"
            placeholder="홍길동"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>언어 · Language</Label>
          <RadioGroup
            className="flex gap-6"
            value={language}
            onValueChange={(value) => setLanguage(value === 'en' ? 'en' : 'ko')}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="ko" id="lang-ko" />
              <Label htmlFor="lang-ko" className="font-normal">
                한국어
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="en" id="lang-en" />
              <Label htmlFor="lang-en" className="font-normal">
                English
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="intake-text">요청 내용</Label>
          <Textarea
            id="intake-text"
            required
            rows={5}
            placeholder="예: 영업 실적 대시보드 하나 만들어 주세요"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            완벽하지 않아도 괜찮아요 — 모호한 부분은 이어지는 질문에서 함께 정리합니다.
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          size="lg"
          disabled={text.trim().length === 0}
          onClick={() => {
            const trimmedName = name.trim();
            onSubmit({
              ...(trimmedName ? { name: trimmedName } : {}),
              language,
              text: text.trim(),
            });
          }}
        >
          요청 보내기
        </Button>
      </CardFooter>
    </Card>
  );
}
