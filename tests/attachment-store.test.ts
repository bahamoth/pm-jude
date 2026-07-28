import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AttachmentStore,
  BlobNotFoundError,
  StorageRefEscapeError,
} from '../src/store/attachment-store';

function makeStore() {
  return new AttachmentStore(mkdtempSync(join(tmpdir(), 'pm-jude-blobs-')));
}

describe('첨부 원본 저장소 (ADR-0011)', () => {
  it('내용 주소로 저장하고 같은 내용을 읽어온다', () => {
    const store = makeStore();
    const bytes = Buffer.from('기획서 본문', 'utf8');

    const stored = store.put(bytes);

    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.storageRef).toBe(`${stored.sha256.slice(0, 2)}/${stored.sha256}`);
    expect(stored.deduped).toBe(false);
    expect(store.read(stored.storageRef).equals(bytes)).toBe(true);
  });

  it('같은 파일을 두 번 올려도 저장은 1회다', () => {
    const store = makeStore();
    const bytes = Buffer.from('같은 자료');

    const first = store.put(bytes);
    const second = store.put(bytes);

    expect(second.storageRef).toBe(first.storageRef);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
  });

  it('내용이 다르면 주소도 다르다', () => {
    const store = makeStore();

    expect(store.put(Buffer.from('A')).sha256).not.toBe(store.put(Buffer.from('B')).sha256);
  });

  it('저장소 루트를 벗어나는 참조는 거부한다 — DB 값이라도 경로로 믿지 않는다', () => {
    const store = makeStore();

    expect(() => store.read('../../etc/passwd')).toThrow(StorageRefEscapeError);
    expect(() => store.exists('..')).toThrow(StorageRefEscapeError);
  });

  it('없는 원본을 읽으면 실패한다', () => {
    const store = makeStore();

    expect(store.exists(`ff/${'f'.repeat(64)}`)).toBe(false);
    expect(() => store.read(`ff/${'f'.repeat(64)}`)).toThrow(BlobNotFoundError);
  });

  it('바이너리를 손상 없이 보존한다', () => {
    const store = makeStore();
    // PNG 시그니처 — 텍스트로 처리되면 깨지는 바이트열
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const stored = store.put(bytes);

    expect(store.read(stored.storageRef).equals(bytes)).toBe(true);
  });
});

describe('저장소 루트 격리', () => {
  it('서로 다른 루트는 서로의 원본을 보지 못한다', () => {
    const a = makeStore();
    const b = makeStore();
    const stored = a.put(Buffer.from('A만 가진 자료'));

    expect(a.exists(stored.storageRef)).toBe(true);
    expect(b.exists(stored.storageRef)).toBe(false);
  });

  it('원본은 저장소 루트 아래 평범한 파일로 남는다 — 읽기에 특별한 도구가 필요하지 않다', () => {
    const root = mkdtempSync(join(tmpdir(), 'pm-jude-blobs-'));
    const store = new AttachmentStore(root);
    const bytes = Buffer.from('본문');

    const stored = store.put(bytes);

    expect(readFileSync(join(root, stored.storageRef)).equals(bytes)).toBe(true);
  });
});
