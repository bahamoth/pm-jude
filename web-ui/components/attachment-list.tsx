'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { attachmentUrl } from '@/lib/api';
import { t, type Lang } from '@/lib/i18n';
import type { AttachmentView } from '@/lib/types';

/**
 * 문서 화면의 첨부 목록 (F1-Attach, ADR-0011 결정 6) — 원문 전사와 같은 지위다.
 * 자료에서 확정된 것은 이미 문서 문장으로 들어가 있고, 파일은 대조용으로 남는다.
 *
 * 읽지 못한 자료도 사유와 함께 남긴다 — 올린 자료가 반영되지 않은 채 조용히 사라지면
 * 요청자는 그 사실을 영영 모른다.
 */
export function AttachmentList({
  lang,
  sessionId,
  attachments,
}: {
  lang: Lang;
  sessionId: string;
  attachments: AttachmentView[];
}) {
  if (attachments.length === 0) return null;
  const failed = attachments.filter((file) => file.extractionStatus === 'failed');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t(lang, 'attach.docTitle')}</CardTitle>
        <CardDescription>{t(lang, 'attach.docNote')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {attachments.map((file) => (
          <div key={file.id} className="flex items-center gap-2 text-sm">
            <a
              className="min-w-0 flex-1 truncate underline underline-offset-2"
              href={attachmentUrl(sessionId, file.id)}
              download={file.filename}
            >
              {file.filename}
            </a>
            {file.extractionStatus === 'failed' && (
              <Badge variant="outline" className="shrink-0 border-dashed">
                {t(lang, 'attach.readFailed')}
              </Badge>
            )}
          </div>
        ))}
        {failed.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>{t(lang, 'attach.readFailed')}</AlertTitle>
            <AlertDescription>
              {failed.map((file) => (
                <span key={file.id}>
                  {file.filename} — {file.extractionError ?? ''}
                </span>
              ))}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
