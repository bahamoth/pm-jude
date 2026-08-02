## 13. 용어집 (비개발자 독자용)

> **EN** — PRD §13 — plain-language glossary written for non-developer readers, plus Appendix A reference links. For the canonical engineering vocabulary used in code and issue titles, use `CONTEXT.md` instead.

- **인테이크(Intake)** — 들어온 요청을 받아 방어·정제하는 첫 단계.
- **명확화 루프** — 질문-답변 반복으로 모호성을 해소하는 대화 과정. 수행 주체는 LLM.
- **컨텍스트 그라운딩** — 질문을 만들기 전에 기존 이슈·문서·과거 결정을 검색해 요청을 맥락 위에 놓는 것. 이미 답이 있는 것을 묻지 않기 위한 장치.
- **완결성 게이트 / 2층 판정** — 정제 완료 여부를 (1) 룰 층: 필수 슬롯·형식의 기계적 검사(결정론적), (2) LLM 층: 남은 의미적 모호성 판정의 두 겹으로 결정하는 구조.
- **슬롯 3상태 / 승격** *(v1.4)* — 각 필수 항목은 `충족`·`미충족`·`승격` 중 하나다. **승격**은 "요청자가 원리적으로 답할 수 없어 담당자 지정 오픈이슈로 올린 항목"을 뜻한다. 승격이 있으면 요청은 멈추지 않고 "조건부"로 개발자에게 간다.
- **중복 병합** *(v1.4)* — 같은 요청이 이미 있을 때 새 이슈를 만들지 않고 기존 이슈에 요청자를 붙이는 종결 방식. 요청자는 그대로 진행 상황을 받는다.
- **역주입** *(v1.4)* — 목업 위 코멘트에서 확정된 내용을 요구사항 문서 문장으로 되돌려 넣는 것. 문서만 남겨도 구현할 수 있게 만들기 위함.
- **규범 다이어그램** *(v2.0)* — 요구사항 문서 안에 그림(흐름도·화면 구성 등)으로 실리는 확정 내용. 요청자가 원본과 대조해 확인한 뒤에만 구현 근거가 된다. 원본 첨부는 계속 참고용.
- **앵커 코멘트 / 부분 패치 / 구조 분기 갤러리** *(v2.0)* — 목업 반복의 세 방식: 고칠 요소를 클릭해 그 자리에 의견을 남기고(앵커 코멘트), 그 부분만 고쳐 다시 보여주며(부분 패치), 화면 구조가 갈리는 곳은 2~3안 중에서 고르게 한다(갤러리).
- **패턴 레지스트리** *(v2.0)* — 목업의 뼈대가 되는 화면 패턴(대시보드, 목록-상세, 입력 마법사 등)의 모음. 테마 레지스트리가 "겉모습"의 후보라면 이것은 "구조"의 후보다.
- **사후 검증** *(v2.0)* — 배포 며칠 뒤 "원래 문제가 풀렸습니까?"를 요청자에게 묻는 마지막 확인. 안 풀렸다는 답은 처음부터 다시 설명할 필요 없이 후속 요청으로 이어진다.
- **외부 지식 커넥터** *(v2.0)* — 조직이 이미 쓰고 있는 지식 저장소(Obsidian 노트, Fireflies 회의록)를 검색 소스로 연결만 하는 장치. PM Jude가 지식을 직접 쌓지는 않는다.
- **세션 귀속(provenance)** *(v1.4)* — 만들어진 이슈에 "어느 세션에서 나왔는지"를 기계가 읽을 수 있게 남기는 것. 이것이 있어야 우회를 자동으로 셀 수 있다.
- **문서 단일 진실 원천** *(v1.4)* — 구현의 근거는 요구사항 문서 하나뿐이며, 대화·목업·번역본은 그것을 대체하지 않는다는 원칙.
- **고정 오케스트레이션(사전 정의된 제어 흐름)** — 단계의 순서·전이를 LLM이 아니라 코드의 상태 머신이 결정하는 방식. 자율 에이전트 루프의 반대 개념.
- **결정론적** *(용법 한정)* — 같은 입력이면 항상 같은 출력이 나오고 무작위성이 없다는 뜻. LLM 호출은 결정론적이지 않다. 본 문서에서는 룰 기반 검사와 게이트 강제 코드에만 이 표현을 쓴다.
- **선행 지표 / 후행 지표** *(v1.4)* — 선행 지표는 문제가 커지기 전에 먼저 움직이는 수치(세션 이탈율), 후행 지표는 결과가 확정된 뒤에 보이는 수치(우회율). 둘 다 필요하되, 판단은 선행 지표로 한다.
- **베이스라인** — 지표 판정의 기준 수치. v1.4의 소급 분석은 v1.6에서 폐기(ADR-0012) — 초기 운영 구간의 자기 세션 데이터가 기준선이 되고, 개선은 버전 간 추이(vN 대비 vN+1)로 판정한다.
- **EARS** — 정형 요구사항 구문(Mavin et al., IEEE RE'09). **INVEST** — 좋은 유저스토리 6기준(Bill Wake, 2003). **Given-When-Then** — BDD 수용기준 서식.
- **코딩 에이전트** — 개발자가 코드를 짜는 데 쓰는 AI 도구. 본 제품은 스펙만 넘긴다.
- **채널 어댑터** — 코어를 특정 표면(웹/Slack/Teams…)에 연결하는 탈부착 모듈.
- **언퍼링** — 메신저의 링크 미리보기 자동 생성. 데이터 유출 통로가 될 수 있어 끈다.
- **목업** — 요구 확인용 중간충실도 인터랙티브 화면. 구현 결과물·코드 기준이 아니다.
- **우회율** — PM Jude를 거치지 않고 개발자에게 직접 간 요청의 비율. 정책 강제 후에는 채택이 아니라 **컴플라이언스** 지표로 읽는다.
- **LLM-as-judge** — LLM 출력의 품질 채점을 다른 LLM에게 맡기는 기법. 기본 비활성이며 L2 도입 조건(§12) 충족 후에만 활성.
- **골든 데이터셋(골든셋)** — 회귀 평가의 기준으로 쓰는 익명화 실제 세션 모음. 평가용/개선용 분리, 분기 갱신, 자체 버전 관리(F12).
- **회귀 평가** — 프롬프트·스키마 변경분을 골든셋에 다시 돌려 기존 품질이 깨지지 않았는지 확인하는 절차. 미통과 버전은 런타임에 로드되지 않는다(F12).
- **프롬프트 레지스트리** — 프롬프트를 버전 단위로 등록·관리하는 저장소. 런타임 세션은 항상 명시적 버전을 참조한다(F12).
- **카나리 배포** — 새 버전을 신규 세션 일부에만 적용하고 재측정 후 승격/롤백하는 배포 방식.
- **Goodhart 법칙** — 지표가 목표가 되는 순간 좋은 지표이기를 멈춘다는 경험칙. 반려율을 단독 최적화하지 않고 짝지표와 함께 평가하는 근거(§10).
- **헤드리스 하네스(`claude -p` / Claude Agent SDK)** — Claude Code를 UI 없이 프로그램적으로 실행하는 방식. Phase 0 한정 임시 백엔드.
- **PoC** — 최소 구성으로 핵심 가설(명확화 품질·채택)을 검증하는 선행 단계.

---

## 부록 A — 참고 링크
- ChatPRD: chatprd.ai · Linear Asks/Intake: linear.app/asks, linear.app/intake
- Linear Agent 공개 베타(2026-03): linear.app/changelog/2026-03-24-introducing-linear-agent · Linear for Agents(Developer Preview): linear.app/developers/agents, /agent-interaction · 에이전트 시트 비과금: linear.app/docs/agents-in-linear
- Linear Webhooks: linear.app/developers/webhooks
- ClarifyGPT: arXiv:2310.10996 (FSE/ACM 2024)
- EARS: alistairmavin.com/ears · INVEST: xp123.com (Bill Wake, 2003)
- Slack Bolt Assistant: docs.slack.dev/tools/bolt-js · 언퍼링 보안: docs.slack.dev/messaging/unfurling-links-in-messages
- Claude Artifacts 샌드박스 패턴: code.claude.com/docs/en/artifacts · CSP sandbox: content-security-policy.com/sandbox
- Cloudflare R2/Workers: developers.cloudflare.com
- 모델 추상화: ai-sdk.dev · docs.litellm.ai · AWS Bedrock Converse API
- 오케스트레이션 원칙(workflows vs agents, "predefined code paths"): anthropic.com/research/building-effective-agents
- 평가 도구(채택 후보): langfuse.com(셀프호스트) · promptfoo.dev
- Claude Code 헤드리스/Agent SDK: code.claude.com/docs

*비고: 외부 도구·API 상태는 2026-07 기준이며 변동 가능. Linear for Agents API는 Developer Preview로 GA 전 변경 가능성이 명시되어 있고, Linear Agent는 2026-03 공개 베타 상태다. 벤더가 고볼륨 자동화 기능의 과금 모델을 GA 시점에 변경할 수 있다고 예고한 점은 Phase 3 네이티브화 판단 시 재확인 대상이다.*
