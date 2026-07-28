import { PromptRegistry } from './registry';
import { attachmentExtractionPromptV0 } from './attachment-extraction-v0';
import { clarificationPromptV0 } from './clarification-v0';
import { clarificationPromptV1 } from './clarification-v1';
import { completenessPromptV0 } from './completeness-v0';
import { promotionPromptV0 } from './promotion-v0';
import { requirementsPromptV0 } from './requirements-v0';

/** v0은 등록만 유지한다 — 버전은 불변이고 과거 세션의 신호가 여기 귀속돼 있다. */
export const CLARIFICATION_V0 = 'clarification@0.1.0';
/** 현행 — Jude의 목소리를 얹은 판 (ADR-0010). */
export const CLARIFICATION_V1 = 'clarification@0.2.0';
export const COMPLETENESS_V0 = 'completeness@0.1.0';
/** 왕복 상한 도달 시에만 호출되는 승격 판정 (F2c ①②, G-9). */
export const PROMOTION_V0 = 'promotion@0.1.0';
export const REQUIREMENTS_V0 = 'requirements@0.1.0';
/** 이미지 첨부를 텍스트로 환원한다 — 이미지가 모델에 원본으로 닿는 유일한 지점 (ADR-0011). */
export const ATTACHMENT_EXTRACTION_V0 = 'attachment-extraction@0.1.0';

/** 리포지토리에 정의된 모든 프롬프트 버전이 등록된 레지스트리를 만든다. */
export function createDefaultRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(clarificationPromptV0);
  registry.register(clarificationPromptV1);
  registry.register(completenessPromptV0);
  registry.register(promotionPromptV0);
  registry.register(requirementsPromptV0);
  registry.register(attachmentExtractionPromptV0);
  return registry;
}
