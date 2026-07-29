import { PromptRegistry } from './registry';
import { attachmentExtractionPromptV0 } from './attachment-extraction-v0';
import { backInjectionPromptV0 } from './back-injection-v0';
import { condensationPromptV0 } from './condensation-v0';
import { clarificationPromptV0 } from './clarification-v0';
import { clarificationPromptV1 } from './clarification-v1';
import { clarificationPromptV2 } from './clarification-v2';
import { completenessPromptV0 } from './completeness-v0';
import { completenessPromptV1 } from './completeness-v1';
import { mockupPromptV0 } from './mockup-v0';
import { promotionPromptV0 } from './promotion-v0';
import { requirementsPromptV0 } from './requirements-v0';
import { requirementsPromptV1 } from './requirements-v1';
import { uiClassificationPromptV0 } from './ui-classification-v0';

/** 구 버전은 등록만 유지한다 — 버전은 불변이고 과거 세션의 신호가 여기 귀속돼 있다. */
export const CLARIFICATION_V0 = 'clarification@0.1.0';
/** Jude의 목소리를 얹은 판 (ADR-0010). */
export const CLARIFICATION_V1 = 'clarification@0.2.0';
/** 현행 — 첨부 자료를 읽고 이미 답이 있는 것을 묻지 않는 판 (F1-Attach, ADR-0011). */
export const CLARIFICATION_V2 = 'clarification@0.3.0';
export const COMPLETENESS_V0 = 'completeness@0.1.0';
/** 현행 — 슬롯 판정에 출처(대화/첨부)가 붙는 판 (F2c, ADR-0011 결정 8). */
export const COMPLETENESS_V1 = 'completeness@0.2.0';
/** 왕복 상한 도달 시에만 호출되는 승격 판정 (F2c ①②, G-9). 첨부는 컨텍스트만 늘리므로 본문 무변경. */
export const PROMOTION_V0 = 'promotion@0.1.0';
export const REQUIREMENTS_V0 = 'requirements@0.1.0';
/** 현행 — 첨부 유래 확정 사항을 문서 문장으로 흡수하는 판 (F3, ADR-0011 결정 6). */
export const REQUIREMENTS_V1 = 'requirements@0.2.0';
/** 이미지 첨부를 텍스트로 환원한다 — 이미지가 모델에 원본으로 닿는 유일한 지점 (ADR-0011). */
export const ATTACHMENT_EXTRACTION_V0 = 'attachment-extraction@0.1.0';
/** 문서 첫 게시 시점의 UI 분류 (F4 전제, #54) — 목업 단계 진입 여부를 정한다. */
export const UI_CLASSIFICATION_V0 = 'ui-classification@0.1.0';
/** 목업 구조 층 HTML 생성·재생성 (F4, #54) — 테마·워터마크는 코드가 입힌다. */
export const MOCKUP_V0 = 'mockup@0.1.0';
/** 목업 승인 시 어노테이션 확정 사항의 문서 흡수 (F4 역주입, #54). */
export const BACK_INJECTION_V0 = 'back-injection@0.1.0';
/** 장문 첨부의 사실 보존 축약 — 생성 호출 전용 파생물 (#58, ADR-0014). */
export const CONDENSATION_V0 = 'condensation@0.1.0';

/** 리포지토리에 정의된 모든 프롬프트 버전이 등록된 레지스트리를 만든다. */
export function createDefaultRegistry(): PromptRegistry {
  const registry = new PromptRegistry();
  registry.register(clarificationPromptV0);
  registry.register(clarificationPromptV1);
  registry.register(clarificationPromptV2);
  registry.register(completenessPromptV0);
  registry.register(completenessPromptV1);
  registry.register(promotionPromptV0);
  registry.register(requirementsPromptV0);
  registry.register(requirementsPromptV1);
  registry.register(attachmentExtractionPromptV0);
  registry.register(uiClassificationPromptV0);
  registry.register(mockupPromptV0);
  registry.register(backInjectionPromptV0);
  registry.register(condensationPromptV0);
  return registry;
}
