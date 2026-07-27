# 단계 전이는 코드 상태 머신이 결정한다 (고정 오케스트레이션)

> **EN** — Stage transitions are decided by a hand-written state machine, not by the model. The LLM exists only as structured calls inside a stage; the single exception is the bounded tool-call loop for context grounding. Hard constraints — no issue without approval, no unregressed prompt version, no session closed without a reply — are enforced in code rather than requested in a prompt.

인테이크→명확화→문서→목업→게이트→이슈→추적의 전이는 코드로 작성된 상태 머신이 결정하고, LLM은 단계 안의 구조화 호출(질문 생성, 완결성 채점, 문서 생성, 목업 생성, 품질 채점 + 보조 호출)로만 존재한다. LLM 자율 툴콜 루프는 F2a 컨텍스트 검색 한 곳에만 허용하며, 그마저 검색 도구만 노출하고 호출 횟수 상한을 둔다. 하드 제약 — 승인 없는 이슈 생성 불가, 회귀 미통과 버전 로드 불가, 종결 시 회신 없이는 세션 종료 불가 — 는 프롬프트로 부탁하지 않고 코드로 강제한다.

## Considered Options

자율 에이전트 루프(LLM이 다음 단계를 스스로 결정)는 기각 — 승인 게이트·회신 보장 같은 하드 제약이 프롬프트 준수에 의존하게 되고, 실패 모드의 계측·재현이 어렵다. 시스템의 정확한 기술은 "확률적 구성요소를 감싼 고정 오케스트레이션"이며, "결정론적"이라는 표현은 룰 기반 검사와 게이트 강제 코드에만 쓴다.

출처: PRD v1.4 원칙 2, §7.
