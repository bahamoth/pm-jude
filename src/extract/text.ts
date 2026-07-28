import type { Extractor, ExtractionInput, ExtractionResult } from './types';

/** 널 바이트가 섞여 있으면 텍스트가 아니다 — UTF-8 디코딩은 조용히 성공하므로 직접 본다. */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

/**
 * 텍스트류 추출기 — 디코딩이 전부다. 의존성이 없다.
 *
 * MIME을 믿되 내용도 본다: 확장자만 .csv인 바이너리를 텍스트로 통과시키면 쓰레기 추출물이
 * 명확화 입력에 섞이고, 판정 실패의 원인을 나중에 분리하기 어려워진다.
 */
export const textExtractor: Extractor = {
  version: 'text@0.1.0',
  mimes: [
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/tab-separated-values',
    'application/json',
  ],

  extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (looksBinary(input.bytes)) {
      return Promise.resolve({
        status: 'failed',
        error: '텍스트 파일로 보이지 않는다 — 내용에 바이너리가 섞여 있다',
      });
    }
    const text = input.bytes.toString('utf8').trim();
    if (!text) {
      return Promise.resolve({ status: 'failed', error: '내용이 비어 있다' });
    }
    return Promise.resolve({ status: 'ok', text });
  },
};
