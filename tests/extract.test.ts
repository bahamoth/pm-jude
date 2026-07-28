import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { LlmGateway } from '../src/gateway/gateway';
import { createFakeBackend } from '../src/gateway/fake-backend';
import type { BackendRequest, BackendResponse, LlmBackend } from '../src/gateway/backend';
import { createDefaultRegistry } from '../src/prompts/catalog';
import { createImageExtractor } from '../src/extract/image';
import { ooxmlExtractor } from '../src/extract/ooxml';
import { pdfExtractor } from '../src/extract/pdf';
import {
  ExtractorRegistry,
  UnsupportedMimeError,
  createDefaultExtractorRegistry,
} from '../src/extract/registry';
import { textExtractor } from '../src/extract/text';
import type { Extractor } from '../src/extract/types';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function zip(files: Record<string, string>): Buffer {
  const entries = Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strToU8(content)]),
  );
  return Buffer.from(zipSync(entries));
}

function makeGateway(backend?: LlmBackend) {
  const registry = createDefaultRegistry();
  return new LlmGateway({ backend: backend ?? createFakeBackend(registry), registry });
}

describe('텍스트류 추출기', () => {
  it('UTF-8 텍스트를 그대로 옮긴다', async () => {
    const result = await textExtractor.extract({
      bytes: Buffer.from('# 기획서\n대상: 영업팀', 'utf8'),
      filename: 'spec.md',
      mime: 'text/markdown',
    });

    expect(result).toEqual({ status: 'ok', text: '# 기획서\n대상: 영업팀' });
  });

  it('MIME이 텍스트라도 내용이 바이너리면 거부한다', async () => {
    const result = await textExtractor.extract({
      bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]),
      filename: 'fake.csv',
      mime: 'text/csv',
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('error', expect.stringContaining('바이너리'));
  });

  it('빈 파일은 실패로 분류한다 — 빈 추출물을 성공으로 통과시키지 않는다', async () => {
    const result = await textExtractor.extract({
      bytes: Buffer.from('   \n  '),
      filename: 'empty.txt',
      mime: 'text/plain',
    });

    expect(result).toMatchObject({ status: 'failed', error: '내용이 비어 있다' });
  });
});

describe('OOXML 추출기', () => {
  it('docx의 단락 경계를 개행으로 지킨다', async () => {
    const bytes = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': `<?xml version="1.0"?><w:document><w:body>
        <w:p><w:r><w:t>대상 사용자</w:t></w:r><w:r><w:t>: 영업팀 매니저</w:t></w:r></w:p>
        <w:p><w:r><w:t>해결할 문제: 수작업 집계</w:t></w:r></w:p>
      </w:body></w:document>`,
    });

    const result = await ooxmlExtractor.extract({ bytes, filename: 'spec.docx', mime: DOCX });

    expect(result).toEqual({
      status: 'ok',
      text: '대상 사용자: 영업팀 매니저\n해결할 문제: 수작업 집계',
    });
  });

  it('docx의 XML 엔티티를 디코딩한다', async () => {
    const bytes = zip({
      'word/document.xml': `<w:document><w:p><w:r><w:t>A &amp; B &lt;확인&gt; &#54620;</w:t></w:r></w:p></w:document>`,
    });

    const result = await ooxmlExtractor.extract({ bytes, filename: 'e.docx', mime: DOCX });

    expect(result).toMatchObject({ status: 'ok', text: 'A & B <확인> 한' });
  });

  it('xlsx는 공유 문자열을 풀고 행·셀 경계를 지킨다 — 표는 위치가 의미다', async () => {
    const bytes = zip({
      'xl/sharedStrings.xml': `<sst><si><t>팀명</t></si><si><t>매출</t></si><si><t>영업1팀</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>12400000</v></c></row>
      </sheetData></worksheet>`,
    });

    const result = await ooxmlExtractor.extract({ bytes, filename: 'sales.xlsx', mime: XLSX });

    expect(result).toEqual({
      status: 'ok',
      text: '[sheet1]\n팀명\t매출\n영업1팀\t12400000',
    });
  });

  it('xlsx의 인라인 문자열도 읽는다', async () => {
    const bytes = zip({
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>직접 입력값</t></is></c></row>
      </sheetData></worksheet>`,
    });

    const result = await ooxmlExtractor.extract({ bytes, filename: 'inline.xlsx', mime: XLSX });

    expect(result).toMatchObject({ status: 'ok', text: '[sheet1]\n직접 입력값' });
  });

  it('pptx는 슬라이드 경계를 남기고 10장 이상도 순서대로 읽는다', async () => {
    const slides: Record<string, string> = {};
    for (let i = 1; i <= 11; i++) {
      slides[`ppt/slides/slide${String(i)}.xml`] = `<p:sld><a:t>제${String(i)}장</a:t></p:sld>`;
    }

    const result = await ooxmlExtractor.extract({
      bytes: zip(slides),
      filename: 'deck.pptx',
      mime: PPTX,
    });

    expect(result).toMatchObject({ status: 'ok' });
    const text = result.status === 'ok' ? result.text : '';
    // slide2가 slide10보다 앞이다 — 사전순 정렬이면 여기서 뒤집힌다
    expect(text.indexOf('제2장')).toBeLessThan(text.indexOf('제10장'));
    expect(text).toContain('[슬라이드 11]');
  });

  it('zip을 열 수 없으면 손상·암호로 분류한다', async () => {
    const result = await ooxmlExtractor.extract({
      bytes: Buffer.from('이건 zip이 아니다'),
      filename: 'broken.docx',
      mime: DOCX,
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('error', expect.stringContaining('암호'));
  });

  it('내용이 없는 docx는 실패로 분류한다', async () => {
    const result = await ooxmlExtractor.extract({
      bytes: zip({ 'word/document.xml': '<w:document><w:body></w:body></w:document>' }),
      filename: 'empty.docx',
      mime: DOCX,
    });

    expect(result).toMatchObject({ status: 'failed' });
  });
});

/** 한 장짜리 PDF를 만든다. content가 비면 텍스트 레이어 없는 문서(스캔본과 같은 상태)가 된다. */
function makePdf(content: string): Buffer {
  const objects = [
    `1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n`,
    `2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n`,
    `3 0 obj\n<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>\nendobj\n`,
    `4 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>\nendobj\n`,
    `5 0 obj\n<</Length ${String(content.length)}>>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${String(objects.length + 1)}/Root 1 0 R>>\nstartxref\n${String(xrefStart)}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('PDF 추출기', () => {
  it('텍스트 레이어를 읽어낸다', async () => {
    const result = await pdfExtractor.extract({
      bytes: makePdf('BT /F1 24 Tf 72 700 Td (Target user: sales manager) Tj ET'),
      filename: 'spec.pdf',
      mime: 'application/pdf',
    });

    expect(result).toEqual({ status: 'ok', text: 'Target user: sales manager' });
  });

  it('텍스트 레이어가 없는 PDF는 스캔본으로 분류한다 — 빈 성공으로 통과시키지 않는다', async () => {
    const result = await pdfExtractor.extract({
      bytes: makePdf(''),
      filename: 'scanned.pdf',
      mime: 'application/pdf',
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('error', expect.stringContaining('스캔본'));
  });

  it('PDF로 열 수 없는 파일은 사유와 함께 실패한다', async () => {
    const result = await pdfExtractor.extract({
      bytes: Buffer.from('%PDF-1.4 이지만 실제로는 깨진 파일'),
      filename: 'broken.pdf',
      mime: 'application/pdf',
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('error', expect.stringContaining('PDF'));
  });
});

describe('이미지 추출기', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('서술과 읽어낸 문자를 함께 남긴다', async () => {
    const extractor = createImageExtractor(makeGateway());

    const result = await extractor.extract({
      bytes: png,
      filename: 'screen.png',
      mime: 'image/png',
    });

    expect(result).toMatchObject({ status: 'ok' });
    const text = result.status === 'ok' ? result.text : '';
    expect(text).toContain('매출 관리 화면의 캡처');
    expect(text).toContain('영업1팀');
  });

  it('원본 이미지가 백엔드까지 실려 간다 — 추출 호출은 텍스트 단일 경로의 예외다', async () => {
    const seen: BackendRequest[] = [];
    const spy: LlmBackend = {
      run(request): Promise<BackendResponse> {
        seen.push(request);
        return Promise.resolve({
          outputText: JSON.stringify({ readable: true, description: '캡처', textContent: [] }),
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      },
    };
    const extractor = createImageExtractor(makeGateway(spy));

    await extractor.extract({ bytes: png, filename: 'a.png', mime: 'image/png' });

    expect(seen[0]?.images).toEqual([{ mime: 'image/png', base64: png.toString('base64') }]);
  });

  it('읽어낼 내용이 없으면 모델이 준 사유를 그대로 실패로 옮긴다', async () => {
    const blind: LlmBackend = {
      run(): Promise<BackendResponse> {
        return Promise.resolve({
          outputText: JSON.stringify({
            readable: false,
            description: '',
            textContent: [],
            unreadableReason: '해상도가 낮아 글자를 분간할 수 없다',
          }),
          usage: { inputTokens: 0, outputTokens: 0 },
        });
      },
    };
    const extractor = createImageExtractor(makeGateway(blind));

    const result = await extractor.extract({
      bytes: png,
      filename: 'blurry.png',
      mime: 'image/png',
    });

    expect(result).toEqual({
      status: 'failed',
      error: '해상도가 낮아 글자를 분간할 수 없다',
    });
  });

  it('게이트웨이 호출이 실패해도 예외가 아니라 결과로 돌아온다', async () => {
    const broken: LlmBackend = {
      run(): Promise<BackendResponse> {
        return Promise.reject(new Error('백엔드 다운'));
      },
    };
    const extractor = createImageExtractor(makeGateway(broken));

    const result = await extractor.extract({ bytes: png, filename: 'x.png', mime: 'image/png' });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result).toHaveProperty('error', expect.stringContaining('백엔드 다운'));
  });
});

describe('추출기 레지스트리', () => {
  it('Phase 0 등록 세트는 4군을 덮는다', () => {
    const registry = createDefaultExtractorRegistry(makeGateway());

    expect(registry.supports('text/markdown')).toBe(true);
    expect(registry.supports(DOCX)).toBe(true);
    expect(registry.supports('application/pdf')).toBe(true);
    expect(registry.supports('image/png')).toBe(true);
    // SVG는 허용 타입에서 제외한다 (ADR-0011 결정 13 — 인라인 렌더 위험)
    expect(registry.supports('image/svg+xml')).toBe(false);
  });

  it('미등록 MIME은 조용한 실패가 아니라 예외다 — 업로드 검증의 구멍을 가리지 않는다', async () => {
    const registry = createDefaultExtractorRegistry(makeGateway());

    await expect(
      registry.extract({ bytes: Buffer.from('x'), filename: 'a.zip', mime: 'application/zip' }),
    ).rejects.toBeInstanceOf(UnsupportedMimeError);
  });

  it('추출기가 던진 예외는 결과로 바뀐다 — 첨부 하나가 라운드를 죽이지 않는다', async () => {
    const throwing: Extractor = {
      version: 'boom@0.1.0',
      mimes: ['application/x-boom'],
      extract() {
        throw new Error('내부 폭발');
      },
    };
    const registry = new ExtractorRegistry();
    registry.register(throwing);

    const outcome = await registry.extract({
      bytes: Buffer.from('x'),
      filename: 'a.boom',
      mime: 'application/x-boom',
    });

    expect(outcome).toMatchObject({ status: 'failed', extractorVersion: 'boom@0.1.0' });
    expect(outcome.error).toContain('내부 폭발');
  });

  it('결과에는 추출기 버전이 실린다 — 재추출 시 어느 판으로 만든 캐시인지 가른다', async () => {
    const registry = createDefaultExtractorRegistry(makeGateway());

    const outcome = await registry.extract({
      bytes: Buffer.from('본문'),
      filename: 'a.txt',
      mime: 'text/plain',
    });

    expect(outcome).toEqual({ status: 'ok', text: '본문', extractorVersion: 'text@0.1.0' });
  });

  it('같은 MIME을 두 추출기가 맡을 수 없다', () => {
    const registry = new ExtractorRegistry();
    registry.register(textExtractor);

    expect(() =>
      registry.register({
        version: 'other@0.1.0',
        mimes: ['text/plain'],
        extract: () => {
          throw new Error('unused');
        },
      }),
    ).toThrow(/이미 등록된 MIME/);
  });

  it('지원 목록을 알려준다 — 요청자에게 무엇을 올릴 수 있는지 말하는 근거', () => {
    const registry = createDefaultExtractorRegistry(makeGateway());

    expect(registry.supportedMimes()).toContain('application/pdf');
    expect(registry.supportedMimes()).toEqual([...registry.supportedMimes()].sort());
  });
});
