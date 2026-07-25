---
status: accepted (2026-07-25)
---

# Phase 0 세션 저장소는 SQLite다

세션·전사·슬롯 상태·신호·버전 귀속의 저장은 SQLite로 시작한다. 파일 기반이라 PoC 인프라 부담이 없으면서도 관계형 스키마로 버전 귀속(세션 × 프롬프트/모델/임계치/슬롯 스키마 버전)을 Phase 0부터 강제할 수 있고, PoC 세션이 골든셋 시드가 되므로(F12) 구조화 저장이 필요하다.

## Considered Options

- JSONL 파일: 기각 — 버전 귀속 집계·조회가 불편하고 Phase 1 전환 시 재설계가 필요하다.
- Postgres부터 시작: 기각 — PoC 단계에서 Docker 등 인프라 운영 부담이 생겨 F14의 "인프라 최소화" 목적과 상충한다.

## Consequences

Phase 1에서 Postgres로 전환하는 것을 전제로 한다. 마이그레이션 비용을 낮추기 위해 ORM/쿼리 빌더는 SQLite와 Postgres를 모두 지원하는 것(예: Drizzle)을 쓰고, SQLite 전용 기능에 의존하지 않는다.
