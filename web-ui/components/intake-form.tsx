'use client';

import { useEffect, useState } from 'react';
import { AttachmentPicker } from '@/components/attachment-picker';
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
import { getUploadPolicy } from '@/lib/api';
import { rememberLang, t, type Lang } from '@/lib/i18n';
import type { UploadedFile, UploadPolicy } from '@/lib/types';

export interface IntakeInput {
  name?: string;
  language: 'ko' | 'en';
  text: string;
  /** 함께 올린 자료 (F1-Attach) — 선택이며, 없다고 여정이 달라지지 않는다. */
  uploadIds?: string[];
}

// 간이 식별(이름·언어) + 요청 원문 — SSO·매직 링크 대체 (ADR-0007).
export function IntakeForm({
  lang,
  onLangChange,
  onSubmit,
  onType,
}: {
  lang: Lang;
  /** 언어 라디오를 바꾸면 화면 언어도 따라간다 */
  onLangChange?: (lang: Lang) => void;
  onSubmit: (input: IntakeInput) => void;
  /** 키 입력 한 번 = Jude에게 소리 한 번 (docs/persona/jude.md) */
  onType?: () => void;
}) {
  const [name, setName] = useState('');
  // 요청자가 고른 언어는 화면 언어이자 명확화 질문의 언어다 (F2b)
  const [language, setLanguage] = useState<Lang>(lang);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  // 무엇을 올릴 수 있는지는 고르기 전에 알려야 한다 (P-U1). 조회 실패는 첨부 없는 폼으로 강등.
  const [policy, setPolicy] = useState<UploadPolicy>({ enabled: false });
  useEffect(() => {
    getUploadPolicy()
      .then(setPolicy)
      .catch(() => setPolicy({ enabled: false }));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t(lang, 'intake.title')}</CardTitle>
        <CardDescription>{t(lang, 'intake.lede')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2">
          <Label htmlFor="intake-name">{t(lang, 'intake.name')}</Label>
          <Input
            id="intake-name"
            autoComplete="name"
            placeholder={t(lang, 'intake.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>{t(lang, 'intake.language')}</Label>
          <RadioGroup
            className="flex gap-6"
            value={language}
            onValueChange={(value) => {
              const next: Lang = value === 'en' ? 'en' : 'ko';
              setLanguage(next);
              rememberLang(next);
              onLangChange?.(next);
            }}
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
          <Label htmlFor="intake-text">{t(lang, 'intake.text')}</Label>
          <Textarea
            id="intake-text"
            required
            rows={5}
            placeholder={t(lang, 'intake.textPlaceholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onType?.();
            }}
          />
          <p className="text-xs text-muted-foreground">{t(lang, 'intake.hint')}</p>
        </div>
        <AttachmentPicker lang={lang} policy={policy} files={files} onChange={setFiles} />
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
              ...(files.length > 0 ? { uploadIds: files.map((file) => file.uploadId) } : {}),
            });
          }}
        >
          {t(lang, 'intake.submit')}
        </Button>
      </CardFooter>
    </Card>
  );
}
