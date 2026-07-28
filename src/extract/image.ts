import type { LlmGateway } from '../gateway/gateway';
import { ATTACHMENT_EXTRACTION_V0 } from '../prompts/catalog';
import type { AttachmentExtractionOutput } from '../prompts/attachment-extraction-v0';
import type { Extractor, ExtractionInput, ExtractionResult } from './types';

/**
 * 이미지 추출기 — 이미지가 모델에 원본으로 닿는 유일한 지점이다 (ADR-0011 결정 3).
 *
 * 결과는 텍스트이며 그 텍스트만 파이프라인으로 흘러간다. 세션당 한 번 일어나는 호출이라
 * 라운드 곱셈이 없고, 게이트웨이를 거치므로 타임아웃·동시성·비용 로깅이 그대로 적용된다.
 */
export function createImageExtractor(gateway: LlmGateway): Extractor {
  return {
    version: 'image-describe@0.1.0',
    mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],

    async extract(input: ExtractionInput): Promise<ExtractionResult> {
      let output: AttachmentExtractionOutput;
      try {
        const result = await gateway.complete<AttachmentExtractionOutput>(
          ATTACHMENT_EXTRACTION_V0,
          { filename: input.filename, mime: input.mime },
          { images: [{ mime: input.mime, base64: input.bytes.toString('base64') }] },
        );
        output = result.output;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'failed', error: `이미지를 읽지 못했다: ${message}` };
      }
      if (!output.readable) {
        return {
          status: 'failed',
          error: output.unreadableReason ?? '이미지에서 읽어낼 내용이 없다',
        };
      }
      // 서술과 원문 문자를 함께 남긴다 — 서술만으로는 레이블·수치가 사라지고,
      // 문자만으로는 배치와 관계가 사라진다
      const parts = [output.description.trim()];
      if (output.textContent.length > 0) {
        parts.push(`읽어낸 문자: ${output.textContent.join(' / ')}`);
      }
      const text = parts.filter(Boolean).join('\n');
      return text ? { status: 'ok', text } : { status: 'failed', error: '추출 결과가 비어 있다' };
    },
  };
}
