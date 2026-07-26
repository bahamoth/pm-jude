# 리서치 — 인테이크·대기·재개 UX 관례 (#27)

> 성격: 단계형 인테이크·트리아지를 가진 검증된 제품(Typeform, Jira Service Management, Zendesk, Linear, GitHub, Intercom)과 확립된 디자인 시스템·UX 리서치(GOV.UK Design System, HMRC, Atlassian Design System, Zendesk Garden, NN/g)의 공식 문서를 1차 출처로 조사한 결과다. 소비처는 [docs/ux/requester-journey.md](../ux/requester-journey.md)(보드 #23 — 조사 시점엔 feat/22 브랜치, 이후 main 병합)이며, §3에서 그 문서의 화면 설계(§5.1~§5.7)에 시사점을 대응시킨다.

## 1. 요약 — 관례 5축

| 축 | 관례 요지 |
|---|---|
| ① 대기·이탈·복귀 | 1초 초과면 진행 표시, 10초 초과면 잔여량·시간 추정 표시가 NN/g 기준. 서비스데스크·메신저 계열은 대기 중 이탈을 전제로 설계한다 — 예상 응답 시간을 먼저 제시하고(Intercom), 복귀는 알림(이메일·Slack 스레드)이 끌어온다 |
| ② 위치 표시 | 다단계 플로우의 단계 목록 + 현재 단계 강조가 위저드 관례(NN/g·Atlassian·Zendesk Garden). 단, GOV.UK는 폼 채우기용 진행 표시는 「없이 먼저 테스트」가 원칙 — 필요 시 「Question 3 of 7」식 단순 카운트만. 분기 폼의 비율형 진행바는 오해를 만든다(Typeform 문서가 명시) |
| ③ 중단 후 재개 | 브라우저 저장 기반 재개는 같은 브라우저·기기 한정의 취약 경로로 문서화된다(Typeform 15일). 내구적 재개 경로는 ⓐ 요청 목록(JSM·Zendesk 「My requests」) ⓑ 알림 속 딥링크(GitHub 자동 구독, Linear Asks 동기화 스레드) ⓒ 저장 고지 + 보존 기간 명시(HMRC 「30일」) 세 겹이다 |
| ④ 답 못하는 문항 | GOV.UK — 「모르겠다」가 유효한 답이면 선택지로 제공하고, 안 물은 질문은 숨기되 건너뛴 선택 문항은 「Not answered」로 노출한다. GitHub issue forms는 문항별 required 선언 + 선택 드롭다운의 「None」 예약어로 무답을 데이터화한다 |
| ⑤ 다음 단계 예고 | GOV.UK confirmation page 필수 요소 — 참조 번호·「다음에 무슨 일이 언제」·연락처·기록 저장 수단. 서비스데스크는 상태를 요청자 언어로 축약해(Zendesk 3종, JSM status-name 매핑) 「누구 차례인지」를 알리고, 트리아지 결과(수용·중복 병합·거절·보류)마다 사유 코멘트를 관례로 둔다(Linear) |

## 2. 축별 관례 상세

### 2.1 축 ① — 장시간 비동기 처리의 대기·이탈·복귀

**NN/g — 시간 임계값과 표시 형식.** 1초를 넘는 동작에는 진행 표시를 두고, 2~10초는 스피너, 10초 초과는 잔여량(percent-done) 표시가 기준이다. 긴 대기에는 「This might take at least a minute」 같은 시간 추정 문구를 더하고, 기다릴 수 없는 사용자를 위한 중단 경로를 제공한다. ([NN/g — Progress Indicators Make a Slow System Less Insufferable](https://www.nngroup.com/articles/progress-indicators/))

**Intercom — 대기 전 기대치 설정.** Messenger에 예상 응답 시간을 상시 노출한다 — 「In a few minutes / hours / In a day」 프리셋, 커스텀 시간, 최근 7일 중앙값 기반 동적 시간 중 선택. 근무 시간 밖이면 응답 시간 대신 팀 복귀 시점을 보여준다. 문서가 목적을 명시한다: 「This allows your customer to plan their next move based on real information」 — 빠르면 기다리고, 늦으면 다른 일을 하러 떠난다. 이탈을 실패가 아니라 정상 경로로 설계한다. ([Intercom — Share your expected response time](https://www.intercom.com/help/en/articles/732436-share-your-expected-response-time))

**Zendesk·JSM — 복귀는 알림이 끌어온다.** 요청 갱신 시 이메일 알림이 나가고, 알림이 꺼져 있어도 상태 변화 이력은 포털에 남는다(JSM: 「Customer-visible status changed」 알림을 꺼도 상태 이력은 포털에 반영). 요청자가 화면을 지키는 모델이 아니라, 떠났다가 알림으로 돌아오는 모델이 기본값이다. ([Atlassian — Disable customer portal status change auto-responses](https://support.atlassian.com/jira/kb/how-to-disable-customer-notifications-for-a-specific-transition/), [Zendesk — Submitting and tracking requests](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal))

**GitHub·Linear — 참여 즉시 자동 구독.** GitHub는 대화에 참여(작성·코멘트·멘션)하면 자동 구독되어 이후 활동이 알림으로 온다. Linear Asks는 Slack 메시지에서 이슈를 만들면 Linear와 Slack 사이 동기화 스레드가 유지되어, 요청자는 도구를 옮기지 않고 자기 채널에서 진행을 본다. ([GitHub Docs — About notifications](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications), [Linear Docs — Linear Asks](https://linear.app/docs/linear-asks))

### 2.2 축 ② — 다단계 진행의 위치 표시

**위저드 계열 — 단계 목록 + 현재 단계 강조.** NN/g 위저드 권고: 「Communicate a clear mental model of the process by displaying a list or a diagram of the steps involved and highlighting the current step」 — 한 번에 한 단계씩 보여주는 구조는 전체 길이와 맥락을 잃게 하므로 단계 지도가 필요하다. Atlassian progress tracker는 「여러 화면에 걸친 태스크 플로우에서 현재 위치 표시 + 단계 간 내비게이션」 용도로 정의되고, Zendesk Garden Stepper는 「순차적 태스크의 단계 안내」 용도로 세로형이 기본이다. ([NN/g — Wizards](https://www.nngroup.com/articles/wizards/), [Atlassian Design System — Progress tracker](https://atlassian.design/components/progress-tracker/), [Zendesk Garden — Stepper](https://garden.zendesk.com/components/stepper/))

**GOV.UK — 폼 진행 표시는 「없이 먼저 테스트」.** 질문 페이지 패턴: 진행 표시 없이 먼저 테스트하고, 필요하면 「Question 3 of 7」식 단순 카운트만 쓴다. 전체 질문을 나열하고 이전 질문으로 이동을 허용하는 스텝형 표시는 「눈에 안 띄고, 자리를 차지하고, 좁은 화면에서 어렵다」는 이유로 지양 — 여러 정부 서비스가 이런 표시를 제거해도 완료율에 영향이 없었다(Carer's Allowance의 12단계 표시 제거 사례). ([GOV.UK Design System — Question pages](https://design-system.service.gov.uk/patterns/question-pages/), [GDS Design Notes — One thing per page](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/))

**Typeform — 분기 폼에서 비율형 진행바의 한계.** 진행바는 완료 문항 수/전체 문항 수 비율로 차는데, Logic 분기 경로마다 문항 수가 다르면 채워진 정도가 요동친다고 문서가 명시한다. 문항 수가 동적으로 변하는 폼에서 비율형 표시는 오해를 만든다. ([Typeform — Activate the Progress bar](https://help.typeform.com/hc/en-us/articles/360051557892-Activate-the-Progress-bar))

**종합 — 두 층위의 분리.** 관례는 「여정 스테퍼」(요청이 어느 단계에 있나 — 위저드·트래커 계열)와 「폼 진행 표시」(이 라운드에서 몇 문항 남았나 — GOV.UK 카운트 계열)를 서로 다른 장치로 다룬다. 서비스데스크는 여정 층위에 스테퍼 대신 상태 칩(축 ⑤)을 쓴다.

### 2.3 축 ③ — 중단 후 재개

**Typeform — 브라우저 저장의 명시적 한계.** 미제출 답변은 브라우저에 기본 15일 보관되지만, 「같은 브라우저·같은 기기, 시크릿 모드 제외」 조건이 문서에 명시된다. 서버 측 부분 응답 수집(partial responses)은 상위 플랜의 별도 기능이다. 클라이언트 저장만으로는 재개 보장이 안 된다는 것을 제품 스스로 문서화한 사례다. ([Typeform — Save and return to your form later](https://help.typeform.com/hc/en-us/articles/360029581051-Save-and-return-to-your-form-later), [Typeform — Collect partial responses](https://help.typeform.com/hc/en-us/articles/21102221958676-Collect-partial-responses))

**NN/g — 위저드의 중간 이탈·재개.** 「Allow users to exit the wizard midway and save state. Allow them to resume the process at a later time.」 ([NN/g — Wizards](https://www.nngroup.com/articles/wizards/))

**HMRC — 저장 사실 + 보존 기간의 명시.** 서비스 장애 페이지에서도 「We saved your answers. They will be available for 30 days.」로 저장 여부와 보존 기간을 문장으로 밝힌다(저장 안 됐으면 「You will have to start again」으로 정직하게). 저장·보존은 시스템 내부 사정이 아니라 사용자에게 고지할 계약이다. ([HMRC Design Patterns — There is a problem with the service](https://design.tax.service.gov.uk/hmrc-design-patterns/there-is-a-problem-with-the-service))

**JSM·Zendesk — 요청 목록이 내구적 복귀 경로.** JSM 헬프센터의 요청 목록은 상태·요청 유형·작성자(내가 만든 것/참여자로 공유된 것)로 필터되고, Zendesk 고객 포털은 프로필 > My activities > Requests에서 제목·티켓 ID·생성일·마지막 활동·상태 컬럼으로 나열한다. 목록의 각 항목이 요청 상세로 가는 영구 링크다. ([Atlassian — See the requests list from your customers' point of view](https://support.atlassian.com/jira-service-management-cloud/docs/see-the-requests-lists-from-your-customers-point-of-view/), [Zendesk — Submitting and tracking requests](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal))

**GOV.UK — 페이지 분할 구조가 재개를 가능하게 한다.** 한 페이지 한 질문 구조의 근거에 「errors, branches, loops and saving progress를 다루기 좋다」가 포함된다 — 문항 단위 분할 자체가 저장·재개의 전제다. ([GDS User Research blog — No more accordions](https://userresearch.blog.gov.uk/2015/08/13/no-more-accordions-how-to-choose-a-form-structure/))

### 2.4 축 ④ — 답 못하는 문항의 처리

**GOV.UK — 「모르겠다」는 유효한 답.** 「Let users answer with 'I'm not sure' or 'I do not know' if these are valid answers.」 체크박스에는 「none」 선택지를 명시적으로 두어 무답과 미응답을 구분한다. ([GOV.UK Service Manual — Designing good questions](https://www.gov.uk/service-manual/design/designing-good-questions), [GDS Design Notes — Letting users tick a none checkbox](https://designnotes.blog.gov.uk/2021/11/15/letting-users-tick-a-none-checkbox/))

**GOV.UK — 요약 화면에서 무답의 노출.** Check answers 패턴은 건너뛴 선택 문항을 숨기지 않고 「Not answered / Not provided」로 표시하고, 각 답에 개별 수정(Change) 링크를 단다. 반면 분기 로직 때문에 아예 묻지 않은 질문은 표시하지 않는다 — 「안 물은 것」과 「못 답한 것」의 구분이 관례다. ([GOV.UK Design System backlog — Check answers](https://github.com/alphagov/govuk-design-system-backlog/issues/36), [NHS design system — Check answers](https://service-manual.nhs.uk/design-system/patterns/check-answers))

**GitHub issue forms — 문항 단위 required 선언 + 「None」 예약어.** 각 필드에 `validations: required: true/false`를 선언하고, 필수가 아닌 드롭다운에는 무선택을 뜻하는 「None」이 예약어로 존재한다. 못 답하는 문항을 막지 않되, 무답을 구조화된 값으로 남긴다. ([GitHub Docs — Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms))

**NN/g — 해당 없는 경로의 제거.** 분기 로직으로 「users don't need to bother with the path that does not apply to them」 — 답 못하는 문항의 1차 대응은 스킵 UI가 아니라 애초에 묻지 않는 것이다. ([NN/g — Wizards](https://www.nngroup.com/articles/wizards/))

**Linear — 트리아지 측의 「나중에」.** 정보가 부족한 이슈는 코멘트로 되묻고 Triage에 남기거나 스누즈한다. 스누즈는 「지정 시각 또는 새 활동 발생 중 먼저 오는 쪽」에 자동 복귀 — 요청자의 답변(새 활동)이 보류를 자동으로 깨우는 트리거다. ([Linear Docs — Triage](https://linear.app/docs/triage))

### 2.5 축 ⑤ — 제출 후 다음 단계 예고

**GOV.UK — confirmation page 필수 요소.** 트랜잭션 종료 시점의 확인 페이지에 반드시 포함: 「a reference number, if there is one / details of what happens next and when / contact details for the service / links to information or services that users are likely to need next / a way for users to save a record of the transaction」. 「다음에 무슨 일이」만이 아니라 「언제」까지가 필수 요소다. ([GOV.UK Design System — Confirmation pages](https://design-system.service.gov.uk/patterns/confirmation-pages/))

**Zendesk — 상태의 요청자 언어 축약.** 에이전트용 6개 상태(New·Open·Pending·On-hold·Solved·Closed)를 포털에서는 3개(Open · **Awaiting your reply** · Solved)로 접는다 — 「customer portal ticket statuses are meant to make sense from the end-user's perspective」. 핵심은 「지금 누구 차례인가」를 상태 이름 자체가 말하는 것이다. ([Zendesk — What are the customer portal ticket statuses?](https://support.zendesk.com/hc/en-us/articles/4408825864858-What-are-the-customer-portal-ticket-statuses))

**JSM — status-name 매핑과 SLA·승인 알림.** 요청 유형별로 「Status name to show customer」를 두어 내부 워크플로 상태 여러 개를 요청자용 이름 하나로 합칠 수 있다(예: 「Waiting for Triage」·「Waiting for Support」 → 「Waiting for Support」). 고객 가시 상태로 전이될 때 요청자에게 알림이 나가고, 승인 단계 진입 시 승인자에게 알림이 나간다. SLA는 기본적으로 내부 지표이며 포털 노출은 설정 사항이다(Data Center 4.18.1+). ([Atlassian — Customize the workflow statuses for a request type](https://support.atlassian.com/jira-service-management-cloud/docs/customize-the-workflow-statuses-for-a-request-type/), [Atlassian — Managing service project notifications](https://confluence.atlassian.com/servicemanagementserver/managing-service-project-notifications-939926348.html), [Atlassian — SLA is not visible in customer portal](https://support.atlassian.com/jira/kb/sla-is-not-visible-in-customer-portal-in-jira-service-management/))

**Linear — 트리아지 결과 4종과 사유 코멘트.** Accept(코멘트 옵션과 함께 팀 워크플로로)·Mark as duplicate(첨부·고객 요청을 canonical 이슈로 이관, 원본은 Canceled)·Decline(「adding a comment with an explanation」 옵션)·Snooze. 거절·중복에 설명을 남기는 것이 제품이 유도하는 기본 동선이다. ([Linear Docs — Triage](https://linear.app/docs/triage))

**Zendesk — 종결 후 재요청의 승계.** Closed 티켓은 변경·재오픈이 불가하고, 닫힌 티켓에 온 응답은 원본을 참조하는 follow-up 티켓을 자동 생성해 대부분의 데이터를 승계한다. 「종결은 불변, 이어가기는 참조 승계」 모델이다. ([Zendesk — Understanding follow-up tickets](https://support.zendesk.com/hc/en-us/articles/8421655952026-Understanding-follow-up-tickets))

## 3. requester-journey.md 화면별 시사점 (§5.1~§5.7 대응)

각 항목에 **지지**(관례가 현 설계를 뒷받침) / **수정**(관례상 설계 변경·보강 필요)을 표시한다.

### §5.1 홈 — 내 요청 목록

- **지지** — 카드 필드 구성(첫 문장·상태 칩·마지막 갱신·오픈이슈 수)은 Zendesk 요청 목록 기본 컬럼(제목·ID·생성·마지막 활동·상태), JSM 요청 목록 필터 축과 일치한다. 정본 상태를 그대로 노출하지 않고 요청자 언어 상태 칩으로 접는 방침은 Zendesk 3종 축약·JSM status-name 매핑과 같은 관례다.
- **수정 M-1** — 상태 칩 세트에 「내 차례」 신호가 없다. Zendesk의 「Awaiting your reply」처럼 요청자 행동이 필요한 상태(보류, 슬롯 확인 대기)를 목록에서 구분되는 칩·색으로 표시해야 한다. 현 설계의 칩(정리 중/문서 완성/보류/검토 중)은 시스템 관점 분류라 「기다리면 되는 상태」와 「내가 움직여야 하는 상태」가 갈리지 않는다.
- **수정 M-2 (Q1 연관)** — localStorage 목록은 Typeform이 문서화한 브라우저 저장의 한계(같은 브라우저·기기, 시크릿 제외, 15일)와 같은 취약 경로다. 관례상 내구적 복귀 경로는 알림 속 딥링크이므로, Phase 1 매직 링크 전이라도 접수 화면에서 딥링크 URL 저장·공유를 명시적으로 안내해 localStorage 유실에 대비해야 한다(§5.2와 연동).

### §5.2 인테이크 → 접수 직후

- **지지** — 제출 즉시 요청 ID와 접수 확인을 보여주는 전환은 GOV.UK confirmation page의 「reference number」 요소와 일치. 「닫아도 사라지지 않아요」 고지는 HMRC 저장 고지 관례와 방향이 같다.
- **수정 M-3** — GOV.UK 필수 요소는 「what happens next **and when**」이다. 현 설계의 「지금 질문을 만들고 있어요」에는 「언제」가 없다 — 예상 소요(예: 「보통 1~2분 안에 질문이 준비돼요」)를 접수 화면에 명시해야 한다. NN/g의 시간 추정 문구, Intercom의 예상 응답 시간 노출과 같은 관례다.
- **수정 M-4** — HMRC 관례상 저장 고지는 보존 기간까지 포함한다(「available for 30 days」). 「사라지지 않아요」에 세션 보존 기간(정책 확정 필요)을 병기하는 것이 정직한 고지다.

### §5.3 명확화 마법사 (라운드 n)

- **지지** — 「모르겠다」 상시 제공은 GOV.UK 「'I do not know' if these are valid answers」와 정확히 일치. 문항별 마법사(한 번에 한 질문)는 GOV.UK one thing per page의 근거(집중·오류 처리·분기·저장에 유리)를 그대로 갖는다. 라운드 맥락 카드(충족 슬롯 요약 + 남은 슬롯 개수)는 NN/g의 「단계 지도 + 현재 위치」 권고의 데이터 기반 구현이다.
- **수정 M-5** — 라운드 내 문항 진행 표시는 비율형 진행바가 아니라 카운트형(「3번째 / 남은 N개」)이어야 한다. 근거: GOV.UK는 「Question 3 of 7」식 단순 카운트만 허용하고, Typeform 문서는 분기 로직에서 비율바가 요동친다고 명시한다 — 라운드마다 문항 수가 동적으로 정해지는 이 제품 구조에서 비율바는 오해를 만든다. 현행 「라운드 내 진행률」(§1)이 비율형이면 교체 대상이다.
- **지지** — 마지막 라운드 예고·승격 인과 마이크로카피는 축 ⑤ 관례(발동 전 예고, 결과의 사유 표시)와 부합. GitHub issue forms의 「None」 예약어처럼 「모르겠다」를 구조화된 값(오픈이슈)으로 승격하는 설계는 무답의 데이터화 관례와 같다.

### §5.4 판정 대기

- **지지** — 단계 메시지 회전·경과 표시·타임아웃 시 이탈 경로는 NN/g 권고(10초 초과 시 잔여·추정 표시, 중단 옵션 제공)와 부합. 「떠나도 됩니다」 문구는 Intercom의 이탈 전제 설계와 같은 방향이다.
- **수정 M-6** — 경과 표시만 있고 기대치가 없다. NN/g는 「This might take at least a minute」식 추정 문구를, Intercom은 실측 기반 동적 시간(최근 중앙값)을 관례로 보여준다 — 대기 카드에 대기 종류별 예상 소요를 명시하고, 가능하면 실측 기반으로 갱신한다. 「떠나도 됩니다」는 예상 시간과 결합할 때 행동 가능한 정보가 된다(기다릴지 떠날지 선택).

### §5.5 문서 + 슬롯 단위 요청자 확인

- **지지** — 정리 결과 카드 + 값별 「맞아요/아니에요」는 GOV.UK check answers 패턴(답 요약 + 항목별 Change 링크)과 동형이다. 「아니에요」가 전체 재시작이 아니라 해당 슬롯 한정 되물음인 것도 항목별 수정 관례와 일치.
- **지지** — 오픈이슈를 숨기지 않고 「개발팀 확인 N건」으로 노출하는 설계는 check answers의 「건너뛴 문항을 Not answered로 표시」 관례와 같다 — 못 답한 것을 요약 화면에서 지우지 않는다.
- **수정 M-7** — 다음 예고에 「언제」 요소 보강. GOV.UK confirmation 필수 요소는 시점을 포함하므로, Phase 0의 정직한 예고(「검토는 준비 중입니다」)에도 문서 전달 방식·시점(예: 「이 문서가 개발팀에 전달됩니다 — 전달 후 연락 채널」)과 연락처(GOV.UK 「contact details for the service」)에 해당하는 정보가 필요하다. 현 설계에는 문의·이의 채널이 어느 화면에도 없다.

### §5.6 보류(정보 부족) → 재개

- **지지** — 「이어서 보태기」(이력 승계 재개)는 관례의 핵심과 일치한다: NN/g 「exit midway and save state … resume later」, Zendesk follow-up의 데이터 승계(전사·슬롯·라운드 이력 = 승계 대상). 「무엇이 부족했는지」(미충족 슬롯 나열) 고지는 Linear decline의 설명 코멘트 관례와 같다.
- **수정 M-8 (Q2·G-4 연관)** — 재개 트리거 관례의 반영. Linear 스누즈는 「새 활동이 오면 자동 복귀」다 — 보류 세션에 요청자 답변이 오면 그것이 곧 재개 트리거이며, 별도 「재개 버튼 → 입력」 2단계가 아니라 입력 자체가 재개가 되는 것이 관례에 맞는다. 또한 코어의 재개 전이 구현(G-4)이 어려울 경우, Zendesk follow-up 모델(종결 세션은 불변으로 두고, 원본을 참조하며 이력을 승계한 새 세션 생성)이 검증된 대안 구조임을 Q2 논의에 반영한다 — 어느 쪽이든 「축적을 버리지 않는다」가 관례의 불변 조건이다.

### §5.7 Phase 1 자리 (검토 현황·역보고·중복 병합)

- **지지** — 게이트 결과 4종(승인/질문/백로그/거절+이의)은 Linear 트리아지 액션 4종(accept/comment·duplicate/decline+설명·snooze)과 구조가 같고, 거절에 사유·이의 경로를 붙이는 설계는 decline 설명 코멘트 관례와 일치. 게이트 질문 시 ②로 복귀하는 미니 라운드는 Linear의 「코멘트로 되묻고 Triage에 유지」와 동형이다.
- **지지** — 중복 병합(후보 제시 → 수락 시 기존 요청 구독)은 Linear duplicate의 canonical 이관(고객 요청·첨부가 원본으로 합쳐지고 요청자는 원본에서 진행을 봄)과 일치한다.
- **수정 M-9** — SLA 노출 수위. JSM 관례상 SLA 타이머는 기본 내부 지표이고 요청자에게는 상태 전이 알림·응답 기대 시간으로 번역된다. 검토 현황 화면의 「SLA 잔여」는 카운트다운 타이머보다 「N일 안에 결과를 알려드려요」 수준의 기대 문구가 관례에 가깝다 — 미충족 시 타이머는 불신을 만들고, 기대 문구는 예고로 남는다.
- **지지** — 역보고(이슈 상태 변화 이력)는 Zendesk·JSM의 「알림 + 포털 이력」 이중 기록, Linear Asks의 동기화 스레드(요청자 채널로 진행 회신 = P-U6 채널 등가) 관례와 부합한다.

### 종합 — UX 원칙(§2)과 관례의 정합

| 원칙 | 관례 근거 |
|---|---|
| P-U1 침묵 없음 | NN/g 1초/10초 임계값, GOV.UK confirmation 즉시 확인 |
| P-U2 상시 재개 | NN/g 위저드 save & resume, JSM·Zendesk 요청 목록, HMRC 저장 고지 |
| P-U3 막힘 없음 | GOV.UK 「I do not know」, GitHub 「None」 예약어, NN/g 분기 제거 |
| P-U4 위치 가시성 | NN/g 단계 지도, Atlassian progress tracker — 단 폼 층위는 GOV.UK 카운트형(M-5) |
| P-U5 다음 예고 | GOV.UK 「what happens next and when」(M-3·M-7), Intercom 기대 시간(M-6) |
| P-U6 채널 등가 | Linear Asks 동기화 스레드, GitHub 자동 구독 |

여섯 원칙 모두 1차 출처 관례로 뒷받침된다. 수정 항목(M-1~M-9)은 원칙의 폐기가 아니라 구체화다 — 특히 「언제」의 명시(M-3·M-6·M-7)와 「내 차례」 신호(M-1)가 반복적으로 비는 지점이다.

## 4. 출처 목록

| 분류 | 출처 |
|---|---|
| 폼 위저드 | [Typeform — Save and return](https://help.typeform.com/hc/en-us/articles/360029581051-Save-and-return-to-your-form-later) · [Collect partial responses](https://help.typeform.com/hc/en-us/articles/21102221958676-Collect-partial-responses) · [Activate the Progress bar](https://help.typeform.com/hc/en-us/articles/360051557892-Activate-the-Progress-bar) |
| 서비스데스크 | [Atlassian — Requests list (customer view)](https://support.atlassian.com/jira-service-management-cloud/docs/see-the-requests-lists-from-your-customers-point-of-view/) · [Customize workflow statuses for a request type](https://support.atlassian.com/jira-service-management-cloud/docs/customize-the-workflow-statuses-for-a-request-type/) · [Managing service project notifications](https://confluence.atlassian.com/servicemanagementserver/managing-service-project-notifications-939926348.html) · [SLA visibility in portal](https://support.atlassian.com/jira/kb/sla-is-not-visible-in-customer-portal-in-jira-service-management/) · [Zendesk — Submitting and tracking requests](https://support.zendesk.com/hc/en-us/articles/4408846805530-Submitting-and-tracking-requests-in-the-help-center-Customer-Portal) · [Customer portal ticket statuses](https://support.zendesk.com/hc/en-us/articles/4408825864858-What-are-the-customer-portal-ticket-statuses) · [Understanding follow-up tickets](https://support.zendesk.com/hc/en-us/articles/8421655952026-Understanding-follow-up-tickets) |
| 이슈 트래커 | [Linear Docs — Triage](https://linear.app/docs/triage) · [Linear Asks](https://linear.app/docs/linear-asks) · [GitHub Docs — Syntax for issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms) · [About notifications](https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications) |
| 대화형 봇 | [Intercom — Share your expected response time](https://www.intercom.com/help/en/articles/732436-share-your-expected-response-time) |
| 디자인 시스템 | [GOV.UK — Confirmation pages](https://design-system.service.gov.uk/patterns/confirmation-pages/) · [Question pages](https://design-system.service.gov.uk/patterns/question-pages/) · [Designing good questions](https://www.gov.uk/service-manual/design/designing-good-questions) · [Check answers (backlog)](https://github.com/alphagov/govuk-design-system-backlog/issues/36) · [One thing per page](https://designnotes.blog.gov.uk/2015/07/03/one-thing-per-page/) · [None checkbox](https://designnotes.blog.gov.uk/2021/11/15/letting-users-tick-a-none-checkbox/) · [No more accordions](https://userresearch.blog.gov.uk/2015/08/13/no-more-accordions-how-to-choose-a-form-structure/) · [HMRC — There is a problem with the service](https://design.tax.service.gov.uk/hmrc-design-patterns/there-is-a-problem-with-the-service) · [Atlassian Design System — Progress tracker](https://atlassian.design/components/progress-tracker/) · [Zendesk Garden — Stepper](https://garden.zendesk.com/components/stepper/) |
| UX 리서치 (준1차) | [NN/g — Progress Indicators](https://www.nngroup.com/articles/progress-indicators/) · [NN/g — Wizards](https://www.nngroup.com/articles/wizards/) · [NHS — Check answers](https://service-manual.nhs.uk/design-system/patterns/check-answers) |
