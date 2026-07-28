import { extractText } from 'unpdf';
import type { Extractor, ExtractionInput, ExtractionResult } from './types';

/**
 * PDF 추출기 — 텍스트 레이어만 읽는다 (F1-Attach).
 *
 * 스캔본은 페이지가 이미지라 텍스트 레이어가 비어 있다. 이 경우 **빈 결과를 성공으로
 * 통과시키지 않고 실패로 분류한다**: 조용히 빈 텍스트가 들어가면 요청자는 자료를 줬다고
 * 믿는데 판정은 아무것도 못 본 채로 「정보 부족」을 내놓는다. 무엇을 못 읽었는지 말하는
 * 쪽이 정직하다(P-U1).
 */
export const pdfExtractor: Extractor = {
  version: 'pdf-text@0.1.0',
  mimes: ['application/pdf'],

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    let text: string;
    try {
      const result = await extractText(new Uint8Array(input.bytes), { mergePages: true });
      text = result.text.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 암호가 걸린 PDF도 여기로 온다 — 파서가 문서를 열지 못한다
      return { status: 'failed', error: `PDF를 열 수 없다: ${message}` };
    }
    if (!text) {
      return {
        status: 'failed',
        error: '텍스트 레이어가 비어 있다 — 스캔본으로 보인다',
      };
    }
    return { status: 'ok', text };
  },
};
