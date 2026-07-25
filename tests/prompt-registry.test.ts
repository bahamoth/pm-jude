import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  DuplicatePromptVersionError,
  InvalidPromptRefError,
  InvalidPromptVersionError,
  PromptRegistry,
  UnknownPromptVersionError,
} from '../src/prompts/registry';

const outputSchema = z.object({ answer: z.string() });

describe('프롬프트 레지스트리 v0', () => {
  it('등록한 프롬프트 버전을 name@semver 참조로 조회한다', () => {
    const registry = new PromptRegistry();
    registry.register({
      name: 'clarification',
      semver: '0.1.0',
      body: '표적 질문을 생성하라',
      outputSchema,
      regressionPassed: false,
    });

    const version = registry.get('clarification@0.1.0');

    expect(version.name).toBe('clarification');
    expect(version.semver).toBe('0.1.0');
    expect(version.body).toBe('표적 질문을 생성하라');
    expect(version.regressionPassed).toBe(false);
  });

  it('등록되지 않은 버전 참조는 UnknownPromptVersionError로 거부한다', () => {
    const registry = new PromptRegistry();

    expect(() => registry.get('clarification@9.9.9')).toThrow(UnknownPromptVersionError);
  });

  it('name@semver 형식이 아닌 참조는 InvalidPromptRefError로 거부한다', () => {
    const registry = new PromptRegistry();

    expect(() => registry.get('clarification')).toThrow(InvalidPromptRefError);
    expect(() => registry.get('clarification@latest')).toThrow(InvalidPromptRefError);
    expect(() => registry.get('')).toThrow(InvalidPromptRefError);
  });

  it('같은 name@semver의 중복 등록은 DuplicatePromptVersionError로 거부한다', () => {
    const registry = new PromptRegistry();
    const entry = {
      name: 'clarification',
      semver: '0.1.0',
      body: '본문 A',
      outputSchema,
      regressionPassed: false,
    };
    registry.register(entry);

    expect(() => registry.register({ ...entry, body: '본문 B' })).toThrow(
      DuplicatePromptVersionError,
    );
  });

  it('semver 형식이 아닌 버전의 등록은 InvalidPromptVersionError로 거부한다', () => {
    const registry = new PromptRegistry();

    for (const semver of ['1.0', 'abc', '1.0.0-beta', '']) {
      expect(() =>
        registry.register({
          name: 'clarification',
          semver,
          body: '본문',
          outputSchema,
          regressionPassed: false,
        }),
      ).toThrow(InvalidPromptVersionError);
    }
  });
});
