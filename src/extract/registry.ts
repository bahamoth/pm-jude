import type { LlmGateway } from '../gateway/gateway';
import { createImageExtractor } from './image';
import { ooxmlExtractor } from './ooxml';
import { pdfExtractor } from './pdf';
import { textExtractor } from './text';
import type { Extractor, ExtractionInput, ExtractionResult } from './types';

export interface ExtractionOutcome {
  status: 'ok' | 'failed';
  text?: string;
  error?: string;
  /** 이 결과를 만든 추출기 — attachment 행과 신호 payload에 남는다 (ADR-0011 결정 4). */
  extractorVersion: string;
}

/** 등록된 MIME이 아니다 — 업로드 시점에 거부하기 위한 판별에도 쓴다. */
export class UnsupportedMimeError extends Error {}

/**
 * MIME → 추출기 레지스트리 (F1-Attach).
 *
 * 미등록 MIME은 **명시적으로 거부**한다. best-effort로 아무 파일이나 긁으면 쓰레기 추출물이
 * 명확화 입력을 오염시키고, 판정 실패의 원인을 추출 결함과 프롬프트 결함으로 가를 수 없게 된다
 * (F13 판독의 전제). 추출기를 늘리는 일은 등록 한 줄이다.
 */
export class ExtractorRegistry {
  private readonly byMime = new Map<string, Extractor>();

  register(extractor: Extractor): void {
    for (const mime of extractor.mimes) {
      if (this.byMime.has(mime)) {
        throw new Error(`이미 등록된 MIME: ${mime}`);
      }
      this.byMime.set(mime, extractor);
    }
  }

  supports(mime: string): boolean {
    return this.byMime.has(mime);
  }

  /** 요청자에게 「무엇을 올릴 수 있는가」를 알리는 근거. */
  supportedMimes(): string[] {
    return [...this.byMime.keys()].sort();
  }

  /**
   * 추출을 실행한다. 추출기가 던진 예외도 결과로 바꿔 돌려준다 — 첨부 하나가 라운드를
   * 죽이지 않는다(P-U3). 미등록 MIME만 예외로 던진다: 그것은 업로드 시점에 걸러졌어야 할
   * 상태이므로 조용히 실패로 기록하면 검증 구멍을 가리게 된다.
   */
  async extract(input: ExtractionInput): Promise<ExtractionOutcome> {
    const extractor = this.byMime.get(input.mime);
    if (!extractor) {
      throw new UnsupportedMimeError(`추출기가 없는 형식: ${input.mime}`);
    }
    let result: ExtractionResult;
    try {
      result = await extractor.extract(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { status: 'failed', error: `추출 중 오류: ${message}` };
    }
    return result.status === 'ok'
      ? { status: 'ok', text: result.text, extractorVersion: extractor.version }
      : { status: 'failed', error: result.error, extractorVersion: extractor.version };
  }
}

/**
 * Phase 0 등록 세트 — 텍스트류·OOXML·PDF·이미지 4군 (ADR-0011 결정 6).
 * 이미지 추출은 게이트웨이를 거치므로 게이트웨이가 필수 의존이다.
 */
export function createDefaultExtractorRegistry(gateway: LlmGateway): ExtractorRegistry {
  const registry = new ExtractorRegistry();
  registry.register(textExtractor);
  registry.register(ooxmlExtractor);
  registry.register(pdfExtractor);
  registry.register(createImageExtractor(gateway));
  return registry;
}
