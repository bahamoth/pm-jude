# Changelog

## [0.14.0](https://github.com/bahamoth/pm-jude/compare/v0.13.0...v0.14.0) (2026-07-30)


### Features

* [#55](https://github.com/bahamoth/pm-jude/issues/55) — 백엔드 콘솔 로그의 롤링 파일 사본 + AGENTS.md 문서화 ([4d67c65](https://github.com/bahamoth/pm-jude/commit/4d67c65b5f3452f5a5f9e63ccf2807146fa9df84))
* [#56](https://github.com/bahamoth/pm-jude/issues/56) — 게이트웨이 타임아웃 프롬프트별 상한 ([02594be](https://github.com/bahamoth/pm-jude/commit/02594be0d5ba5f27797587d0ff025331e2b90f84))
* [#57](https://github.com/bahamoth/pm-jude/issues/57) — 노션 커넥터: URL을 markdown 첨부로 페치 (ADR-0013) ([b50130e](https://github.com/bahamoth/pm-jude/commit/b50130ed0a7317ca8749756d2047feaf75ee44a3))
* [#58](https://github.com/bahamoth/pm-jude/issues/58) — 장문 소스 규율: 발화 상한 + 생성 한정 압축 + 조립 예산 ([0c6c19c](https://github.com/bahamoth/pm-jude/commit/0c6c19c7ccc24201861cd1b177e7e98118def01e))
* [#59](https://github.com/bahamoth/pm-jude/issues/59) — 레이어드 설정: 스키마 기본값 → pm-jude.config.json → 환경변수 ([27b36e8](https://github.com/bahamoth/pm-jude/commit/27b36e8d584e6f4821e3eb9e4a5884174981e087))
* [#60](https://github.com/bahamoth/pm-jude/issues/60) — 생성 뷰의 대화 예산: 장문 발화도 압축 대상 (ADR-0014 확장) ([beabd29](https://github.com/bahamoth/pm-jude/commit/beabd297cc9425e59b83d3dd29a688f5d1cea989))
* [#60](https://github.com/bahamoth/pm-jude/issues/60) — 프롬프트 버전별 추론 강도(effort) + 백엔드 생성 진행 로그 ([84efb11](https://github.com/bahamoth/pm-jude/commit/84efb1119239c163ad742ea0cd581d5021a1cf60))
* [#61](https://github.com/bahamoth/pm-jude/issues/61) — 명확화 라운드 간 심화: 대화 이력·판정 근거 주입 (clarification@0.4.0) ([14c7661](https://github.com/bahamoth/pm-jude/commit/14c76615a73e65b04127ea871d60712e5e67926a))
* [#63](https://github.com/bahamoth/pm-jude/issues/63) — 세션 사용량·개선 델타 계측 (이터레이션 규율 1단계) ([a488b05](https://github.com/bahamoth/pm-jude/commit/a488b051eb79184531817117c18d3d5c4158d38e))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — 생성 품질 계약 수리: requirements@0.3.0 · condensation@0.2.0 ([3437528](https://github.com/bahamoth/pm-jude/commit/3437528d90e3dcb6f977018e355b70e2b948908c))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — 표 분해 3규칙: 성격별로 가른다 (v4 평가 산출물) ([66b6379](https://github.com/bahamoth/pm-jude/commit/66b6379364079e158d86d1e79d726e58bc195652))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 드래그 선택 정정 UI (5단계) ([bff00f6](https://github.com/bahamoth/pm-jude/commit/bff00f6fc0a633779e2ee610003ac032349416da))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 문서 부분 교정: 직접 편집·자연어 지시, 종결 무관 (2~4단계) ([0f1c645](https://github.com/bahamoth/pm-jude/commit/0f1c645a358b5e0ca0f50513ab7a7026bb7a4946))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 문서 요소 주소 체계 + 항목 단위 렌더 (ADR-0016 1단계) ([e25f395](https://github.com/bahamoth/pm-jude/commit/e25f39567ef862a80d0af6c2e3a69009cef91f50))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 승인된 목업 열람 경로 복원 ([6bc5aa0](https://github.com/bahamoth/pm-jude/commit/6bc5aa0470722884a33bdb9510bf3f6712d6e36c))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 여러 줄 직접 편집(항목 추가·삭제 포함) · 팝오버는 지시 전용 ([67ddd49](https://github.com/bahamoth/pm-jude/commit/67ddd49a1cbbb3fc283584ac387202280d9a1475))
* [#67](https://github.com/bahamoth/pm-jude/issues/67) — 목업 상시 개선: 승인 후에도 코멘트로 반복을 재개한다 ([4cb8af3](https://github.com/bahamoth/pm-jude/commit/4cb8af310b36ac55fcd337e8697eb3d5a68fcd83))


### Bug Fixes

* [#60](https://github.com/bahamoth/pm-jude/issues/60) — 실측 기반 상한 조정: requirements·back-injection 600s, condensation 300s ([2d9dd1c](https://github.com/bahamoth/pm-jude/commit/2d9dd1c291b33d014e30fa160177a08ee0c76db5))
* [#62](https://github.com/bahamoth/pm-jude/issues/62) — 목업 생성 실패의 재시도 경로 + mockup 상한·effort 조정 ([2408da4](https://github.com/bahamoth/pm-jude/commit/2408da4e6cd1e1e6f901b3cd9c1173a6abe44c51))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — A/B 재평가(v2=상) 권고 반영: 계획·측정 이관, 강제성 보존, 압축 16k ([476807c](https://github.com/bahamoth/pm-jude/commit/476807c6e054ecfbe9ce2a166b98ee5432da2800))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — requirements 상한 900s: 생성 시간 실측 궤적 반영 ([bd59bd5](https://github.com/bahamoth/pm-jude/commit/bd59bd5fa873d364b76789d16d5b6e532e634ed5))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — v3 평가 회귀 수리: 요청자 답변의 지위·scope의 역할 ([aca3050](https://github.com/bahamoth/pm-jude/commit/aca305004c1ad8da7ea81fd3392e45d2a300d295))
* [#64](https://github.com/bahamoth/pm-jude/issues/64) — 압축 절단을 최후 수단으로: 허용 배수 1.5 + 재시도 목표 강화 ([54dfe6d](https://github.com/bahamoth/pm-jude/commit/54dfe6d0703aae6ec5cd05dafb63f4f8627e6fa8))
* [#65](https://github.com/bahamoth/pm-jude/issues/65) — 사용량 한도 응답을 스키마 위반으로 오진하지 않는다 ([9dfcaf4](https://github.com/bahamoth/pm-jude/commit/9dfcaf4e3f52c53b6a0f33d1b7d2f756705d2771))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 문서 하단 클릭 시 스크롤 이동·팝오버 실패 ([af0116a](https://github.com/bahamoth/pm-jude/commit/af0116ae4e721014332526d6da83567c84a5e2d9))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 인플레이스 편집 + 세 갈래 닫기 · UX 규약 문서화 ([04c71ee](https://github.com/bahamoth/pm-jude/commit/04c71ee0b6e8e94b7cef571873fc724f7db38967))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 정정을 선택 지점 옆에서: 인라인 팝오버 (UX 재구성) ([48d6946](https://github.com/bahamoth/pm-jude/commit/48d69469ef9db78492fe43f33767210f7ff28fda))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 지시 대상 하이라이트 + 불필요한 스크롤바 제거 ([fa4802b](https://github.com/bahamoth/pm-jude/commit/fa4802bc69ac764fa015afe25e6b2971c80696a4))
* [#66](https://github.com/bahamoth/pm-jude/issues/66) — 클릭만으로 화면이 튀는 문제: 팝오버를 fixed로 ([c8fc3f2](https://github.com/bahamoth/pm-jude/commit/c8fc3f24d323f388fa82cfc11a62b7c6cb0d40c8))

## [0.13.0](https://github.com/bahamoth/pm-jude/compare/v0.12.0...v0.13.0) (2026-07-29)


### Features

* [#54](https://github.com/bahamoth/pm-jude/issues/54) — web-ui 목업 뷰어 (샌드박스 iframe·코멘트·테마 선정·최종 확인) ([0b0112f](https://github.com/bahamoth/pm-jude/commit/0b0112f423dc7f8ffdef680b15109c07f8869869))
* [#54](https://github.com/bahamoth/pm-jude/issues/54) — 목업 반복 코어 루프 (UI 분류·생성·어노테이션·테마 선정·역주입) ([9f16534](https://github.com/bahamoth/pm-jude/commit/9f1653481e3458fa43396a87063bed3d1cd4c85d))
* [#54](https://github.com/bahamoth/pm-jude/issues/54) — 웹 어댑터 목업 표면 + trace 확장 ([8b18e7f](https://github.com/bahamoth/pm-jude/commit/8b18e7f82b486d84debe3ee88c1e39f6599ea545))


### Bug Fixes

* [#54](https://github.com/bahamoth/pm-jude/issues/54) — /code-review 2축 반영 ([00db202](https://github.com/bahamoth/pm-jude/commit/00db202460aa1759dae9c7e674fd94d4749f66ea))

## [0.12.0](https://github.com/bahamoth/pm-jude/compare/v0.11.0...v0.12.0) (2026-07-28)


### Features

* [#53](https://github.com/bahamoth/pm-jude/issues/53) — requirements 문서 구조체 영속 (requirements_doc) ([d9f15e8](https://github.com/bahamoth/pm-jude/commit/d9f15e85ee89772028502db3ad3e7d8b50f8c99f))
* pnpm demo — 남에게 보여주기 위한 빌드 UI 구성 ([c1e7af3](https://github.com/bahamoth/pm-jude/commit/c1e7af347325ad34528953bf14ea17ffee18d810))


### Bug Fixes

* [#51](https://github.com/bahamoth/pm-jude/issues/51) — 완주 후에도 슬롯 정정 진입점 유지 ([0a905b1](https://github.com/bahamoth/pm-jude/commit/0a905b1bbab2924daa09fb4f171d49bd06fd1df5))
* [#52](https://github.com/bahamoth/pm-jude/issues/52) — documented 세션 일반 답변의 채널 무관 코어 가드 ([6b124f9](https://github.com/bahamoth/pm-jude/commit/6b124f9dcb9f318a613edbaaf204385ea5428e64))
* /code-review 2축 리뷰 반영 — 하드 1건·스펙 2건·스멜 3건 ([09cc2e4](https://github.com/bahamoth/pm-jude/commit/09cc2e4de0b3f71b103b3f4e16958cc3335b0299))

## [0.11.0](https://github.com/bahamoth/pm-jude/compare/v0.10.0...v0.11.0) (2026-07-28)


### Features

* 웹 어댑터 — 업로드 스테이징·참조·다운로드 ([#49](https://github.com/bahamoth/pm-jude/issues/49)) ([faf7a5b](https://github.com/bahamoth/pm-jude/commit/faf7a5b30df5ad08e3aa6990aaf0a6bacb5cdb3e))
* 첨부 UI + trace 뷰어 확장 ([#50](https://github.com/bahamoth/pm-jude/issues/50)) ([8aff5d8](https://github.com/bahamoth/pm-jude/commit/8aff5d83ebd2939bb82d10b901e4d297c3a2d345))
* 첨부 저장 계층 — 불변 원본·추출 캐시·스테이징 ([#46](https://github.com/bahamoth/pm-jude/issues/46)) ([dfd7ada](https://github.com/bahamoth/pm-jude/commit/dfd7ada09a4467b22dcbef7f2c0199db90ae7dc3))
* 추출기 레지스트리 — 4군 추출 + attachment-extraction ([#47](https://github.com/bahamoth/pm-jude/issues/47)) ([828b99d](https://github.com/bahamoth/pm-jude/commit/828b99dbcd928e31a09b6a1a7349d85e0c64d8b3))
* 코어 융합 — 첨부 컨텍스트·근거 추적·상한 + 프롬프트 3종 ([#48](https://github.com/bahamoth/pm-jude/issues/48)) ([d96a57a](https://github.com/bahamoth/pm-jude/commit/d96a57a7b64343ae85fdcdac4203d00a30ad9a84))

## [0.10.0](https://github.com/bahamoth/pm-jude/compare/v0.9.0...v0.10.0) (2026-07-27)


### Features

* 요청자 여정 갭 G-9~G-11 — 승격 판정·멱등 재시도·문서 vN ([#44](https://github.com/bahamoth/pm-jude/issues/44)) ([b7864e2](https://github.com/bahamoth/pm-jude/commit/b7864e21951f291b7ab3a2dc9f98060b5e6d34fe))


### Bug Fixes

* 코드 리뷰 반영 — 라운드 정합·상한 판정·완주 기록 ([#44](https://github.com/bahamoth/pm-jude/issues/44)) ([4c88257](https://github.com/bahamoth/pm-jude/commit/4c88257f3fe0796ce011f7d15c791d42e5d2a2aa))

## [0.9.0](https://github.com/bahamoth/pm-jude/compare/v0.8.0...v0.9.0) (2026-07-27)


### Features

* clarification@0.2.0 — Jude의 목소리 반영 ([#43](https://github.com/bahamoth/pm-jude/issues/43)) ([9e52683](https://github.com/bahamoth/pm-jude/commit/9e526839465375067969810231b3c4c2c0adfa4a))
* Jude 아바타 컴포넌트 — 상태 반응 리그 ([#42](https://github.com/bahamoth/pm-jude/issues/42)) ([7d945ac](https://github.com/bahamoth/pm-jude/commit/7d945ac451b900e8ccd7ed6c03eae00ef7bfe2e6))
* UI 카피 전환 + i18n 사전 모듈 ([#41](https://github.com/bahamoth/pm-jude/issues/41)) ([1a88005](https://github.com/bahamoth/pm-jude/commit/1a88005c12f2a560c74ca9999f5673e687292488))

## [0.8.0](https://github.com/bahamoth/pm-jude/compare/v0.7.0...v0.8.0) (2026-07-26)


### Features

* 운영 표면 UI 통일 — shadcn 디자인 언어로 재스타일 ([#37](https://github.com/bahamoth/pm-jude/issues/37)) ([0032b3f](https://github.com/bahamoth/pm-jude/commit/0032b3faef12123f0493bfbf068d5fe14999495a))

## [0.7.0](https://github.com/bahamoth/pm-jude/compare/v0.6.0...v0.7.0) (2026-07-26)


### Features

* pnpm dev 핫 리로드 — API를 tsx watch로 ([#35](https://github.com/bahamoth/pm-jude/issues/35)) ([351dbda](https://github.com/bahamoth/pm-jude/commit/351dbda830344213595599c73d3aee0225529a8c))

## [0.6.0](https://github.com/bahamoth/pm-jude/compare/v0.5.0...v0.6.0) (2026-07-26)


### Features

* pnpm dev — API 서버·웹 UI 동시 기동 러너 ([#35](https://github.com/bahamoth/pm-jude/issues/35)) ([f3d38ac](https://github.com/bahamoth/pm-jude/commit/f3d38ac14dceca958e23d56a5de2c8a6f681ae03))
* 웹 서버 — 범위 제한 SSE 이벤트 스트림·요약 목록·슬롯 확인 API ([#35](https://github.com/bahamoth/pm-jude/issues/35)) ([dd42ccc](https://github.com/bahamoth/pm-jude/commit/dd42ccc3a1b134c0a49028dc8c790fdb3d90d6a7))
* 코어 — 보류 재개·슬롯 확인·문서 정정·인테이크 분리 ([#35](https://github.com/bahamoth/pm-jude/issues/35)) ([6063064](https://github.com/bahamoth/pm-jude/commit/60630649ccbd62e0c110afd7516f8dd7d804c04f))


### Bug Fixes

* 포트 충돌 시 스택 대신 해결 안내 출력 ([#35](https://github.com/bahamoth/pm-jude/issues/35)) ([d3df77d](https://github.com/bahamoth/pm-jude/commit/d3df77ddc73f65d5f75602a5d26ba2047e3b88d1))

## [0.5.0](https://github.com/bahamoth/pm-jude/compare/v0.4.0...v0.5.0) (2026-07-26)


### Features

* web-ui 스캐폴드 — Next.js 16 + shadcn/ui + API 프록시 ([#22](https://github.com/bahamoth/pm-jude/issues/22)) ([26919e3](https://github.com/bahamoth/pm-jude/commit/26919e3d1f2f4d9d84c65a0371bcfe37009c9aaf))
* 마법사 복원·데모 기반 — 질문 구조 신호 영속, latestQuestions, 가짜 백엔드 ([#22](https://github.com/bahamoth/pm-jude/issues/22)) ([c13fb41](https://github.com/bahamoth/pm-jude/commit/c13fb41f390e52fe8e94540f1a03ed918482c0ca))
* 명확화 마법사 UI — 객관식 동선·대기 상태·문서 뷰·세션 재개 ([#22](https://github.com/bahamoth/pm-jude/issues/22)) ([8069e5c](https://github.com/bahamoth/pm-jude/commit/8069e5c6e7b6516c2848bb4e6cf8e9b1513811c9))

## [0.4.0](https://github.com/bahamoth/pm-jude/compare/v0.3.1...v0.4.0) (2026-07-26)


### Features

* 웹 어댑터 — 로컬 http 서버·간이 식별·채팅 UI·pnpm web ([#16](https://github.com/bahamoth/pm-jude/issues/16)) ([27df7ba](https://github.com/bahamoth/pm-jude/commit/27df7bad533ba7c4daed9631a71f08ffc7476cd6))

## [0.3.1](https://github.com/bahamoth/pm-jude/compare/v0.3.0...v0.3.1) (2026-07-26)


### Bug Fixes

* Release Please 동시 실행 직렬화 — 연속 푸시 레이스로 인한 라벨 404 방지 ([#21](https://github.com/bahamoth/pm-jude/issues/21)) ([0acba32](https://github.com/bahamoth/pm-jude/commit/0acba3299c9eec5ea4b8e26cf15829aedee6f288))

## [0.3.0](https://github.com/bahamoth/pm-jude/compare/v0.2.0...v0.3.0) (2026-07-26)


### Features

* architecture.html 재작업 — 수제 SVG 렌더러 폐기, 정본 mermaid 직접 렌더링 ([#19](https://github.com/bahamoth/pm-jude/issues/19)) ([edb4af4](https://github.com/bahamoth/pm-jude/commit/edb4af445eaffeebe42533102d73e5408e450825))
* 세션 트레이스 뷰어 — 세션·전사·슬롯·신호의 상시 추적 가시화 ([#20](https://github.com/bahamoth/pm-jude/issues/20)) ([001739d](https://github.com/bahamoth/pm-jude/commit/001739d4bf99ebb85d22e135b0fdc35e51cd7933))

## [0.2.0](https://github.com/bahamoth/pm-jude/compare/v0.1.0...v0.2.0) (2026-07-26)


### Features

* Slack PoC 러너 — 스레드 인테이크·명확화·문서 게시 ([#8](https://github.com/bahamoth/pm-jude/issues/8)) ([817febc](https://github.com/bahamoth/pm-jude/commit/817febc9a40bbe5775f5859523b89ec3ad9d9627))
* 소급 아카이브 분석 도구 — 추출·분류·집계 파이프라인 ([#9](https://github.com/bahamoth/pm-jude/issues/9)) ([dfa2a5e](https://github.com/bahamoth/pm-jude/commit/dfa2a5edcd696be810a3aad82329582c471e82f7))
* 완결성 판정 프롬프트 v0 + 룰 층 초안 — 2층 판정 결합 ([#6](https://github.com/bahamoth/pm-jude/issues/6)) ([cdbd655](https://github.com/bahamoth/pm-jude/commit/cdbd65589ab3cd604695a5c17e7b078cb0898447))

## 0.1.0 (2026-07-25)


### Features

* LLM 게이트웨이 complete() + Agent SDK 백엔드 어댑터 ([#2](https://github.com/bahamoth/pm-jude/issues/2)) ([486138d](https://github.com/bahamoth/pm-jude/commit/486138d3cb3d590d21db7b4a33815394adfaf74c))
* requirements 프롬프트 v0 — strict 문서 스키마·승격 슬롯 오픈이슈 코드 강제 ([#7](https://github.com/bahamoth/pm-jude/issues/7)) ([74db917](https://github.com/bahamoth/pm-jude/commit/74db9175edc6ceffcd4eaecbf14263f853ba45a7))
* 로컬 CLI 러너 — pnpm intake, 세션 영속화·버전 동기화 ([#12](https://github.com/bahamoth/pm-jude/issues/12)) ([dc63641](https://github.com/bahamoth/pm-jude/commit/dc636410724534052104b344d0aa54350b17774e))
* 명확화 프롬프트 v0 — 표적 질문 스키마 강제·카탈로그·조립 smoke ([#5](https://github.com/bahamoth/pm-jude/issues/5)) ([abf7405](https://github.com/bahamoth/pm-jude/commit/abf7405c1e0c83536dec7a81df4120eea739754c))
* 세션 저장소 — Drizzle/SQLite 스키마·5축 귀속·원문 불변 트리거·익명화 export ([#4](https://github.com/bahamoth/pm-jude/issues/4)) ([0000de4](https://github.com/bahamoth/pm-jude/commit/0000de4c60e0c76a4e6df377e8546cf2b17cc97c))
* 프롬프트 레지스트리 v0 — 버전 등록·조회, regression_passed 필드 ([#3](https://github.com/bahamoth/pm-jude/issues/3)) ([47314b8](https://github.com/bahamoth/pm-jude/commit/47314b85179143ce7ba094d24d81070eff5362fa))
