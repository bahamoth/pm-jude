import type { ZodType } from 'zod';

/** 레지스트리에 등록되는 프롬프트 버전 한 건 (F12 — 런타임은 항상 명시적 버전을 참조한다). */
export interface PromptVersion<TOutput = unknown> {
  name: string;
  semver: string;
  body: string;
  /** 이 버전이 계약하는 구조화 출력 스키마. 게이트웨이가 검증에 사용한다. */
  outputSchema: ZodType<TOutput>;
  /** F12 배포 게이트 플래그. 강제는 Phase 2 발효지만 필드는 지금부터 존재한다. */
  regressionPassed: boolean;
  /**
   * 이 버전의 백엔드 호출 상한(ms) — 선언 시 게이트웨이 전역 상한보다 우선한다 (#56).
   * 장문 생성 프롬프트만 선언한다. 프롬프트 계약(본문·스키마)이 아닌 실행 봉투이므로
   * 값 조정은 semver 증가 사유가 아니다.
   */
  timeoutMs?: number;
  /**
   * 추론(thinking) 강도 (#60 실측 — 기본 high는 생성 시간 편차가 통제 불능: 같은 입력이
   * 353s~600s+). 구조화 계약 출력에 깊은 추론은 과잉인 호출만 낮춘다. timeoutMs와 달리
   * **출력 품질에 영향**하므로, 이후 값 변경은 semver 증가와 함께 한다.
   */
  effort?: 'low' | 'medium' | 'high';
}

export class PromptRegistryError extends Error {}

/** `name@semver` 형식이 아닌 참조. */
export class InvalidPromptRefError extends PromptRegistryError {}

/** 형식은 맞지만 등록된 적 없는 버전 참조. */
export class UnknownPromptVersionError extends PromptRegistryError {}

/** name 또는 semver가 규격을 벗어난 등록 시도. */
export class InvalidPromptVersionError extends PromptRegistryError {}

/** 이미 등록된 name@semver의 재등록 시도. 버전은 불변이다. */
export class DuplicatePromptVersionError extends PromptRegistryError {}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const REF_PATTERN = /^([a-z0-9][a-z0-9-]*)@(\d+\.\d+\.\d+)$/;

export class PromptRegistry {
  private readonly versions = new Map<string, PromptVersion>();

  register(version: PromptVersion): void {
    if (!NAME_PATTERN.test(version.name)) {
      throw new InvalidPromptVersionError(`프롬프트 이름 규격 위반: "${version.name}"`);
    }
    if (!SEMVER_PATTERN.test(version.semver)) {
      throw new InvalidPromptVersionError(
        `semver는 major.minor.patch 형식이어야 한다: "${version.semver}"`,
      );
    }
    if (
      version.timeoutMs !== undefined &&
      (!Number.isInteger(version.timeoutMs) || version.timeoutMs <= 0)
    ) {
      throw new InvalidPromptVersionError(
        `timeoutMs는 양의 정수여야 한다: ${String(version.timeoutMs)}`,
      );
    }
    const ref = `${version.name}@${version.semver}`;
    if (this.versions.has(ref)) {
      throw new DuplicatePromptVersionError(`이미 등록된 프롬프트 버전: ${ref}`);
    }
    this.versions.set(ref, version);
  }

  get(ref: string): PromptVersion {
    if (!REF_PATTERN.test(ref)) {
      throw new InvalidPromptRefError(`프롬프트 버전 참조는 name@semver 형식이어야 한다: "${ref}"`);
    }
    const version = this.versions.get(ref);
    if (!version) {
      throw new UnknownPromptVersionError(`등록되지 않은 프롬프트 버전 참조: ${ref}`);
    }
    return version;
  }
}
