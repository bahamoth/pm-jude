import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export interface StoredBlob {
  sha256: string;
  /** 저장소 루트 기준 상대 경로 — DB에 남는 값. */
  storageRef: string;
  /** 같은 내용이 이미 있어 쓰기를 생략했는가. */
  deduped: boolean;
}

/** DB에 남은 storage_ref가 저장소 루트를 벗어난다. */
export class StorageRefEscapeError extends Error {}

/** 참조된 원본이 저장소에 없다. */
export class BlobNotFoundError extends Error {}

/**
 * 첨부 원본 저장소 (F1-Attach, ADR-0011) — 내용 주소(sha256) 기반.
 *
 * 같은 파일을 두 번 올리면 저장은 1회다. **삭제 API를 두지 않는다**: 원본 보존이 규율이고
 * (트리거가 DB 쪽을 막는다), 미참조 스테이징 정리도 메타 행만 지운다. 여러 세션이 같은
 * 내용을 가리킬 수 있어 참조 카운트 없이는 안전한 삭제가 성립하지 않기도 하다.
 * 일괄 정리는 보존 기간이 정해진 뒤의 일이다(PRD §12-20).
 */
export class AttachmentStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** 내용을 저장하고 주소를 돌려준다. 이미 있으면 쓰지 않는다. */
  put(bytes: Buffer): StoredBlob {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // 한 디렉터리에 파일이 무한정 쌓이지 않도록 앞 두 글자로 나눈다
    const storageRef = `${sha256.slice(0, 2)}/${sha256}`;
    const path = this.pathOf(storageRef);
    if (existsSync(path)) return { sha256, storageRef, deduped: true };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return { sha256, storageRef, deduped: false };
  }

  read(storageRef: string): Buffer {
    const path = this.pathOf(storageRef);
    if (!existsSync(path)) throw new BlobNotFoundError(`원본을 찾을 수 없다: ${storageRef}`);
    return readFileSync(path);
  }

  exists(storageRef: string): boolean {
    return existsSync(this.pathOf(storageRef));
  }

  /** DB 값이라도 경로로 쓰기 전에 루트 안인지 확인한다 — 저장소 밖 파일을 내려주지 않는다. */
  private pathOf(storageRef: string): string {
    const path = resolve(join(this.root, storageRef));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new StorageRefEscapeError(`저장소 루트를 벗어난 참조: ${storageRef}`);
    }
    return path;
  }
}
