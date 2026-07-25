import { PromptRegistry } from './registry';
import { clarificationPromptV0 } from './clarification-v0';
import { completenessPromptV0 } from './completeness-v0';
import { requirementsPromptV0 } from './requirements-v0';

export const CLARIFICATION_V0 = 'clarification@0.1.0';
export const COMPLETENESS_V0 = 'completeness@0.1.0';
export const REQUIREMENTS_V0 = 'requirements@0.1.0';

/** 리포지토리에 정의된 모든 프롬프트 버전이 등록된 레지스트리를 만든다. */
export function createDefaultRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(clarificationPromptV0);
  registry.register(completenessPromptV0);
  registry.register(requirementsPromptV0);
  return registry;
}
