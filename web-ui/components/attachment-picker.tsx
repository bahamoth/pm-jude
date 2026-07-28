'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { uploadFile } from '@/lib/api';
import { t, type Lang } from '@/lib/i18n';
import type { UploadedFile, UploadPolicy } from '@/lib/types';

interface Props {
  lang: Lang;
  /** 서버가 알려준 지원 형식·상한 — 고르기 전에 고지한다 (P-U1). */
  policy: UploadPolicy;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  disabled?: boolean;
  /** 답변에 붙일 때 쓰는 보조 문구 — 인테이크와 마법사의 맥락이 다르다. */
  hintKey?: 'attach.hint' | 'attach.answerHint';
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))}KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 자료 첨부 (F1-Attach, ADR-0011) — 요청자가 입력을 넣는 지점이면 어디서든 같은 컴포넌트를 쓴다.
 *
 * 올린 파일은 아직 발화에 붙지 않은 스테이징 상태이며, 제출이 uploadIds로 참조할 때 첨부가 된다.
 * 거부는 파일별로 즉시 표시한다 — 제출하고 나서 실패를 알게 되는 경로를 만들지 않는다.
 */
export function AttachmentPicker({
  lang,
  policy,
  files,
  onChange,
  disabled,
  hintKey = 'attach.hint',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<Array<{ name: string; reason: string }>>([]);
  if (!policy.enabled) return null;

  const full = files.length >= policy.maxPerSession;

  async function handlePick(picked: FileList | null) {
    if (!picked || picked.length === 0 || !policy.enabled) return;
    setBusy(true);
    setRejected([]);
    const accepted: UploadedFile[] = [];
    const refused: Array<{ name: string; reason: string }> = [];
    // 파일 하나가 요청 하나다 — 하나가 거부돼도 나머지는 올라간다
    for (const file of Array.from(picked).slice(0, policy.maxPerSession - files.length)) {
      try {
        accepted.push(await uploadFile(file));
      } catch (error) {
        refused.push({
          name: file.name,
          reason: error instanceof Error ? error.message : t(lang, 'attach.rejected'),
        });
      }
    }
    onChange([...files, ...accepted]);
    setRejected(refused);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t(lang, 'attach.label')}</span>
        <span className="text-xs text-muted-foreground">
          {t(lang, 'attach.limits', {
            mb: Math.floor(policy.maxBytesPerFile / (1024 * 1024)),
            count: policy.maxPerSession,
          })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t(lang, hintKey)}</p>

      {files.length > 0 && (
        <ul className="grid gap-1">
          {files.map((file) => (
            <li
              key={file.uploadId}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{file.filename}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatBytes(file.bytes)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() => onChange(files.filter((f) => f.uploadId !== file.uploadId))}
              >
                {t(lang, 'attach.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {rejected.map((item) => (
        <p key={item.name} className="text-xs text-destructive">
          {item.name} — {item.reason}
        </p>
      ))}

      <div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={policy.supportedMimes.join(',')}
          onChange={(event) => void handlePick(event.target.files)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || busy || full}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? (
            <>
              <Spinner className="mr-2 size-3" />
              {t(lang, 'attach.uploading')}
            </>
          ) : (
            t(lang, 'attach.pick')
          )}
        </Button>
      </div>
    </div>
  );
}
