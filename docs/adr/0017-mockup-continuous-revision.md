---
status: accepted (2026-07-30)
---

# 목업도 상시 개선된다 — 승인은 구간의 끝이지 화면의 끝이 아니다

> **EN** — Mockup iteration was reachable only while the session sat in `mockup` status. Approving (or hitting the iteration cap) closed five doors at once: three core methods, two HTTP routes, and the UI branch that hosted the panel. A requester who approved a screen and then wanted one thing changed had no path at all — measured on a live session whose only mockup was `approved` with zero annotations. This is the same design ADR-0016 reversed for the document. Per operator report (2026-07-30) the mockup becomes **continuously** revisable: a comment on a closed mockup *is* the request to reopen, it starts a fresh iteration segment, and it does **not** rewind the session — the document and the completion signal stay standing. The iteration cap now bounds a segment rather than a lifetime, so reaching it is a pause, not a wall.

목업 반복은 세션이 `mockup` 상태인 동안에만 닿을 수 있었다. 승인하거나 반복 상한에 걸리면 다섯 개의 문이 동시에 닫혔다 — 코어 메서드 셋(`annotateMockup`·`selectMockupTheme`·`approveMockup`), HTTP 라우트 둘, 그리고 패널을 품고 있던 화면 분기. 실측: 세션 49597175의 목업은 v1 하나, `approved`, 어노테이션 0건 — 요청자가 v1을 코멘트 없이 승인하고 나니 고칠 문이 없었다. 운영자 지적(2026-07-30): 「목업은 이터레이션을 통해 개선 변경하는 UX UI 가 없다」

이것은 ADR-0016이 문서에 대해 뒤집은 바로 그 설계다. 문서를 상시 교정 가능하게 만든 이유가 목업에도 그대로 적용된다 — **요청자가 화면 기대를 맞추는 수단이 「한 번 승인했으니 끝」으로 잠기면 어긋남을 고칠 길이 사라진다.** 그리고 어긋남은 대개 승인한 뒤에 눈에 띈다.

## 결정

**1. 닫힌 판에 온 코멘트가 재개 요청이다.** 별도의 「반복 다시 열기」 행동을 만들지 않는다. 요청자가 하려는 일은 승인 전이든 후든 같다 — 화면을 보고 고칠 곳을 말하는 것이다. 승인·에스컬레이션된 목업에 코멘트가 오면 새 판(vN+1)이 생성되고 그 판은 다시 열린 상태(`iterating`)로 시작한다.

**2. 상태 가드를 걷어낸다.** 어노테이션·테마 선정·승인은 세션 상태를 보지 않고 **판이 열렸는지만** 본다. 코어·웹 어댑터·화면이 같은 기준을 쓴다. 세션 상태를 기준으로 삼으면 잠금이 다섯 곳에 흩어져 하나만 풀어도 나머지가 막는다.

**3. 재개는 여정을 되돌리지 않는다.** 세션은 `documented`에 머문다. 목업 상태로 되돌리면 문서 카드가 사라지고 완주 표시가 걷히면서 **승인이 취소된 것처럼 읽힌다** — 요청자가 한 일은 화면 한 곳을 고치자는 것뿐이다. ADR-0016의 선례와 같다(문서 부분 교정도 세션 상태를 바꾸지 않는다). 결과적으로 `documented` 한 상태에서 목업 카드가 두 모습(열린 판=반복 패널, 닫힌 판=열람+고치기)으로 나온다.

**4. 반복 상한은 구간을 제한한다 — 생애를 제한하지 않는다.** 「지금까지 만든 판 수」로 세면 상한 도달이 영구 잠금이 된다. 구간은 마지막으로 닫힌 판(승인·에스컬레이션) 다음부터 센다. 요청자가 명시적으로 재개하면 새 구간이 열리고 예산도 새로 시작한다. 상한의 목적은 한 번의 확인 사이클이 무한 왕복으로 늘어지는 것을 막는 것이지, 나중에 발견한 문제를 못 고치게 하는 것이 아니다(#63의 방향과 같다 — 하드캡보다 낭비의 가시화).

**5. 재승인은 역주입을 다시 일으킨다.** 재개 구간의 판을 승인하면 어노테이션과 확정된 시각 방향이 문서 vN+1로 흡수된다 — 기존 승인 경로 그대로다. 목업에만 존재하는 확정 사항이 남지 않는다는 원칙 7의 보장이 재개 구간에도 동일하게 적용된다.

**6. 멈춘 이유를 정직하게 말한다.** 상한으로 멈춘 판을 「승인하신 화면」이라 부르지 않는다 — 무엇 때문에 멈췄고 이어서 고칠 수 있다는 사실을 안내한다(원칙 5).

## 상한의 의미 변화

| | 이전 | 이후 |
|---|---|---|
| 세는 단위 | 세션의 전체 목업 수 − 1 | 마지막으로 닫힌 판 이후의 판 수 |
| 상한 도달 | 영구 잠금 (dead end) | 이 구간의 종료 — 코멘트로 재개 가능 |
| 첫 구간 v1 | 반복 아님 | 반복 아님 (요청자가 요청해서 나온 판이 아니다) |
| 재개 구간 첫 판 | — | 1회차 (코멘트로 만들어진 판이다) |

## Consequences

- 목업 버전이 세션 하나에서 계속 늘어날 수 있다. 저장 비용은 HTML 텍스트뿐이고, 판독(F13)에는 이력이 오히려 근거가 된다 — 어느 판에서 무엇이 지적됐고 언제 확정됐는지 재구성할 수 있다.
- 문서 버전도 재승인마다 늘어난다. 역주입 문서가 여러 개 쌓이는 것은 정상이다 — `back_injected_from`이 어느 판에서 나왔는지 가리킨다.
- 완주 신호가 새 문서 버전에서 다시 성립한다(#51의 정정 경로와 동일한 성질). 버전 귀속이 있으므로 「어느 버전에서 완주했는가」는 흐려지지 않는다.
- 재개가 쉬워진 만큼 요청자가 목업을 구현 기준으로 오해할 여지는 커진다. 워터마크와 「구현의 기준은 문서」 카피를 열람 카드에도 유지한다(하드 제약 불변 — 목업 코드는 전달되지 않는다).
- 상한이 사실상 무제한에 가까워졌으므로, 낭비 경고(#63)가 목업 반복에도 필요하다. 이 ADR은 상한을 구간으로 재정의하는 데까지만 결정하고, 비용 가시화는 #63에 맡긴다.
