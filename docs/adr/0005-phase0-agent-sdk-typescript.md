---
status: accepted (2026-07-25)
---

# Phase 0 하네스는 Claude Agent SDK + TypeScript다

> **EN** — The Phase 0 gateway backend is the Claude Agent SDK on TypeScript, isolated behind the gateway's `complete(promptVersion, input) → structuredOutput` interface so it can be swapped for direct API calls once the PoC clears its exit criteria.

Phase 0의 LLM 게이트웨이 백엔드를 Claude Agent SDK(TypeScript)로 확정한다. 하네스는 게이트웨이 표준 인터페이스(`complete(promptVersion, input) → structuredOutput`) 뒤에 격리하고, PoC 목표 달성 시 직접 API로 교체한다(F14 Exit 기준 — 전환 전후 골든셋 시드로 출력 동등성 확인).

## Considered Options

- `claude -p` CLI + 얇은 래퍼: 기각 — SDK가 처리해 주는 세션·구조화 출력·툴 권한 제어를 직접 구현해야 한다. PRD F14도 SDK를 권장.
- Rust 런타임: 기각 — 공식 Agent SDK는 TypeScript·Python 두 언어뿐이라 Rust는 CLI 래핑이 유일한 경로이고, Phase 1 이후의 Slack Bolt(TypeScript)·@linear/sdk(TypeScript)와도 언어가 갈라진다.
- Agent SDK + Python: 기각 — 동작은 동등하나 주변 스택과 2언어 유지보수가 된다.

TypeScript는 PRD가 지정한 주변 스택과 단일 언어로 수렴하고, Phase 1 직접 API 전환 시의 프로바이더 추상화 후보(Vercel AI SDK)도 같은 생태계다.
