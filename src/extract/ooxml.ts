import { strFromU8, unzipSync } from 'fflate';
import type { Extractor, ExtractionInput, ExtractionResult } from './types';

/**
 * OOXML 추출기 — docx·xlsx·pptx는 모두 zip + XML이라 하나로 다룬다 (F1-Attach).
 *
 * XML 파서를 들이지 않고 텍스트 노드만 긁는다. 목적이 문서 구조의 재현이 아니라 **내용을
 * 명확화 입력으로 옮기는 것**이기 때문이다. 다만 표는 예외로 행 경계를 지킨다 — 셀이 한 줄로
 * 뭉개지면 「어느 컬럼의 값인가」가 사라져 자료로서의 값이 없어진다.
 */

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeXml(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** 특정 태그의 텍스트 노드를 순서대로 모은다. */
function textNodes(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(pattern)].map((match) => decodeXml(match[1] ?? ''));
}

type Archive = Record<string, Uint8Array>;

function read(archive: Archive, path: string): string | null {
  const entry = archive[path];
  return entry ? strFromU8(entry) : null;
}

/** 이름 순으로 정렬된 경로들 — slide2가 slide10보다 앞에 오도록 숫자를 수치로 비교한다. */
function sortedPaths(archive: Archive, prefix: string, suffix: string): string[] {
  return Object.keys(archive)
    .filter((path) => path.startsWith(prefix) && path.endsWith(suffix))
    .sort((a, b) => {
      const num = (path: string) => Number(/(\d+)/.exec(path.slice(prefix.length))?.[1] ?? 0);
      return num(a) - num(b);
    });
}

function extractDocx(archive: Archive): ExtractionResult {
  const xml = read(archive, 'word/document.xml');
  if (xml === null) return { status: 'failed', error: 'word/document.xml이 없다 — 손상된 docx다' };
  // 단락 경계를 개행으로 지킨다: <w:t>만 이어 붙이면 문장이 전부 한 줄이 된다
  const paragraphs = xml
    .split('</w:p>')
    .map((paragraph) => textNodes(paragraph, 'w:t').join('').trim())
    .filter(Boolean);
  return paragraphs.length > 0
    ? { status: 'ok', text: paragraphs.join('\n') }
    : { status: 'failed', error: '문서에서 읽어낼 텍스트가 없다' };
}

function extractXlsx(archive: Archive): ExtractionResult {
  const sharedXml = read(archive, 'xl/sharedStrings.xml');
  // <si> 하나가 문자열 하나 — 그 안의 <t>가 서식 때문에 여러 조각으로 나뉘어 있을 수 있다
  const shared = sharedXml
    ? sharedXml
        .split('</si>')
        .slice(0, -1)
        .map((item) => textNodes(item, 't').join(''))
    : [];

  const lines: string[] = [];
  for (const path of sortedPaths(archive, 'xl/worksheets/', '.xml')) {
    const sheet = read(archive, path);
    if (sheet === null) continue;
    const sheetLines: string[] = [];
    for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const row = rowMatch[1] ?? '';
      const cells: string[] = [];
      for (const cellMatch of row.matchAll(/<c(\s[^>]*)?>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
        if (type === 's') {
          const index = Number(textNodes(body, 'v')[0] ?? '');
          cells.push(shared[index] ?? '');
        } else if (type === 'inlineStr') {
          cells.push(textNodes(body, 't').join(''));
        } else {
          cells.push(textNodes(body, 'v')[0] ?? '');
        }
      }
      // 행 경계와 셀 경계를 지킨다 — 표는 위치가 곧 의미다
      if (cells.some((cell) => cell !== '')) sheetLines.push(cells.join('\t'));
    }
    if (sheetLines.length > 0) {
      const name = path.replace('xl/worksheets/', '').replace('.xml', '');
      lines.push(`[${name}]`, ...sheetLines);
    }
  }
  return lines.length > 0
    ? { status: 'ok', text: lines.join('\n') }
    : { status: 'failed', error: '시트에서 읽어낼 값이 없다' };
}

function extractPptx(archive: Archive): ExtractionResult {
  const blocks: string[] = [];
  for (const [index, path] of sortedPaths(archive, 'ppt/slides/slide', '.xml').entries()) {
    const xml = read(archive, path);
    if (xml === null) continue;
    const texts = textNodes(xml, 'a:t')
      .map((text) => text.trim())
      .filter(Boolean);
    // 슬라이드 경계를 남긴다 — 어느 장의 내용인지가 자료 해석의 단위다
    if (texts.length > 0) blocks.push(`[슬라이드 ${String(index + 1)}]\n${texts.join('\n')}`);
  }
  return blocks.length > 0
    ? { status: 'ok', text: blocks.join('\n\n') }
    : { status: 'failed', error: '슬라이드에서 읽어낼 텍스트가 없다' };
}

export const ooxmlExtractor: Extractor = {
  version: 'ooxml@0.1.0',
  mimes: [DOCX, XLSX, PPTX],

  extract(input: ExtractionInput): Promise<ExtractionResult> {
    let archive: Archive;
    try {
      archive = unzipSync(new Uint8Array(input.bytes));
    } catch {
      // 암호화된 오피스 파일도 여기로 온다 — zip 컨테이너 자체를 열 수 없다
      return Promise.resolve({
        status: 'failed',
        error: '파일을 열 수 없다 — 손상되었거나 암호가 걸려 있다',
      });
    }
    switch (input.mime) {
      case DOCX:
        return Promise.resolve(extractDocx(archive));
      case XLSX:
        return Promise.resolve(extractXlsx(archive));
      case PPTX:
        return Promise.resolve(extractPptx(archive));
      default:
        return Promise.resolve({ status: 'failed', error: `다루지 않는 형식: ${input.mime}` });
    }
  },
};
