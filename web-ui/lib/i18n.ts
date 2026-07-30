'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { Utterance } from './types';

/**
 * 요청자 대면 카피 사전 — 라이브러리 없이 평면 키-값 두 벌.
 *
 * next-intl 같은 라우팅 기반 도구를 쓰지 않는 이유: 미들웨어와 서버 경계를 요구하는데
 * 이 앱은 ADR-0008의 「전면 클라이언트 SPA」 계약 아래 있다. 화면이 열 몇 개라 사전으로 충분하다.
 *
 * 문구는 Jude의 목소리다 — 1인칭, 뒷일을 자기 입으로 떠맡고, 사과하지 않고, 이모지를 쓰지 않는다.
 * 규칙은 docs/persona/jude.md. 운영자 표면(이슈 보드·트레이스·허브)은 이 사전의 범위가 아니다.
 */

export type Lang = 'ko' | 'en';
export const LANGS: readonly Lang[] = ['ko', 'en'];

const ko = {
  'brand.sub': '요청 인테이크',
  'nav.myRequests': '내 요청',
  'nav.newRequest': '새 요청',
  'nav.home': '홈으로',
  'common.request': '요청',
  'common.next': '다음',
  'common.prev': '이전',
  'common.retry': '다시 시도',
  'common.continue': '이어서 진행',
  'common.copyLink': '링크 복사',
  'common.copied': '복사됐어요',
  'common.pending': '준비 중',
  'common.dash': '—',

  'intake.title': '무엇을 만들어 드릴까요?',
  'intake.lede':
    '요청을 남겨 주시면 몇 가지만 여쭤보고, 개발팀이 바로 착수할 수 있는 requirements 문서로 정리해 드릴게요.',
  'intake.name': '이름 (선택)',
  'intake.namePlaceholder': '홍길동',
  'intake.language': '언어 · Language',
  'intake.text': '요청 내용',
  'intake.textPlaceholder': '예: 영업 실적 대시보드 하나 만들어 주세요',
  'intake.hint': '완벽하지 않아도 괜찮아요 — 모호한 데는 제가 여쭤보면서 같이 정리할게요.',
  'intake.submit': '요청 보내기',
  'intake.failed': '요청을 보내지 못했어요',

  // 자료 첨부 (F1-Attach) — 첨부는 선택이며, 없다고 여정이 달라지지 않는다
  'attach.label': '참고 자료 (선택)',
  'attach.hint': '이미 정리해 둔 기획서나 화면 캡처가 있으면 함께 올려 주세요. 질문이 줄어듭니다.',
  'attach.pick': '자료 고르기',
  'attach.uploading': '올리는 중…',
  'attach.remove': '빼기',
  'attach.limits': '파일당 {mb}MB까지, 최대 {count}개',
  'attach.rejected': '올리지 못했어요',
  'attach.reading': '자료를 읽고 있어요',
  'attach.readFailed': '읽지 못한 자료',
  'attach.answerHint': '말로 설명하기 어려우면 자료로 주셔도 돼요.',
  'attach.docTitle': '함께 받은 자료',
  'attach.docNote': '참고용이에요 — 구현의 근거는 위 문서입니다.',
  'attach.download': '내려받기',
  'attach.fromFile': '{filename}에서 읽은 값',

  'home.listNote':
    '이 목록은 이 브라우저에만 저장돼요 — 각 요청의 링크를 저장해 두면 어디서든 이어집니다.',
  'home.openIssues': '개발팀 확인 {count}건',

  'ack.title': '접수했어요. 확인 질문을 만들고 있을게요.',
  'ack.eta': '보통 1분 이내, 길면 2분까지 걸려요',
  'ack.failedTitle': '질문을 만들다가 막혔어요',
  'ack.stored': '요청 번호 {id} · 내용은 서버에 저장돼 사라지지 않아요.',
  'ack.deepLink':
    '이 페이지 주소가 요청으로 가는 링크예요 — 링크만 있으면 다른 브라우저에서도 이어집니다.',

  'wait.intake.1': '요청을 받아 적고 있어요…',
  'wait.intake.2': '여러 갈래로 해석해 보고 있어요…',
  'wait.intake.3': '확인할 지점을 골라 질문을 만들고 있어요…',
  'wait.reply.1': '답변을 요구사항에 반영하고 있어요…',
  'wait.reply.2': '빠진 게 없는지 보고 있어요…',
  'wait.reply.3': '다음 단계를 준비하고 있어요…',
  'wait.overdue': '평소보다 오래 걸리고 있어요 — 조금만 더 기다려 주세요.',
  'wait.elapsed': '{seconds}초 경과',
  'wait.normalEta': '보통 수십 초, 길면 2분까지 걸려요',
  'wait.overdueEta': '응답이 없으면 곧 자동으로 중단돼요',
  'wait.leaveOk': '떠나셔도 돼요 — 돌아오시면 이 자리부터 이어집니다. 내용은 서버에 저장돼 있어요.',

  'journey.1': '접수',
  'journey.2': '내용 정리',
  'journey.3': '문서 확정',
  'journey.4': '개발팀 검토',
  'journey.5': '진행·완료',
  'journey.aria': '요청 진행 단계',
  'journey.onHold': '보류',
  'journey.done': '확인 완료',

  'chip.intake': '질문 준비 중',
  'chip.clarifying': '답변해 주세요',
  'chip.documented': '문서 완성 — 확인해 주세요',
  'chip.mockup': '목업 확인 — 화면을 봐 주세요',
  'chip.onHold': '보류 — 언제든 재개',
  'chip.closed': '종결',

  'mockup.title': '화면 목업',
  'mockup.lede': '말씀하신 내용을 화면으로 만들어 봤어요. 직접 눌러 보면서 확인해 주세요.',
  'mockup.version': '목업 v{version}',
  'mockup.iterationsLeft': '수정 기회 {left}회 남음',
  'mockup.grayscaleNote': '지금은 흑백이에요 — 색·분위기는 화면 구성이 정해진 뒤에 골라요.',
  'mockup.openNew': '새 탭에서 크게 보기',
  'mockup.frameTitle': '요구사항 확인용 목업',
  'mockup.commentTitle': '고칠 곳이 있나요?',
  'mockup.commentPlaceholder': '예: 필터는 기간·팀·상태 3종이면 좋겠어요',
  'mockup.sendComment': '코멘트 보내기 — 다음 판에 반영',
  'mockup.annotationsTitle': '남긴 코멘트',
  'mockup.themeTitle': '분위기를 골라 주세요',
  'mockup.themeLede':
    '화면 구성이 마음에 드시면 분위기를 골라 볼 차례예요. 후보를 누르면 위 화면에 바로 입혀 드려요 — 실제 화면으로 비교해 보고 확정해 주세요.',
  'mockup.themePreviewing': '미리보기: {name}',
  'mockup.themeCommit': '이 분위기로 할게요',
  'mockup.themeCurrent': '선택됨',
  'mockup.themeDelegate': '개발팀이 정하는 게 좋겠어요',
  'mockup.themeDelegated': '분위기는 개발팀 몫으로 남겼어요',
  'mockup.approve': '이대로 확정할게요',
  'mockup.approveHint': '확정하면 목업에서 정해진 내용을 문서에 새 버전으로 반영해요.',
  'mockup.approveNeedsTheme': '분위기를 고르거나 개발팀에 맡겨 주시면 확정할 수 있어요.',

  'round.title': '지금까지 이만큼 정리됐어요',
  'round.promoted': '(개발팀 확인으로 넘김)',
  'round.remaining': '아직 남은 것 {count}개 — {labels}',

  'wizard.roundBadge': '명확화 {round}라운드',
  'wizard.lastRound': '마지막 확인',
  'wizard.progress': '질문 {step} / {total}',
  'wizard.reviewing': '답변 확인',
  'wizard.lastRoundNote':
    '이번 답변으로도 정리되지 않은 항목은 제가 개발팀 몫으로 넘기거나, 요청을 보류로 정리할게요.',
  'wizard.pickHint':
    '보기에서 고르시거나 직접 적어 주세요. 답하기 어려우면 「모르겠어요」도 답입니다.',
  'wizard.reviewTitle': '이렇게 보낼게요',
  'wizard.reviewHint': '확인하고 보내 주세요. 문항을 누르면 고칠 수 있어요.',
  'wizard.freeChoice': '직접 입력할게요',
  'wizard.freePlaceholder': '답변을 적어 주세요',
  'wizard.dontKnowNote': '이 항목은 제가 개발팀 확인 목록에 올려둘게요 — 요청은 멈추지 않아요.',
  'wizard.unanswered': '— 미응답',
  'wizard.forTeam': '개발팀 확인',
  'wizard.send': '답변 보내기',
  'wizard.freeTitle': '이어서 답해 주세요',
  'wizard.freeLede': '진행 중인 요청에 보태실 내용을 편하게 적어 주세요.',
  'wizard.freeInputPlaceholder': '추가로 알려주실 내용',

  'slots.title': '정리한 내용이 맞는지 봐 주세요',
  'slots.lede': '항목별로 확인해 주시면 문서가 더 정확해져요.',
  'slots.confirmed': '확인됨 ✓',
  'slots.yes': '맞아요',
  'slots.no': '아니에요',
  'slots.correct': '정정하기',
  'slots.correctPlaceholder': '실제로는 어떤가요? 바로잡아 주세요',
  'slots.sendCorrection': '정정 보내기',
  'slots.promotedTitle': '개발팀이 확인할 항목 {count}건',
  'slots.promotedNote': '답하지 않으셔도 돼요. 개발팀 검토에서 확정됩니다.',

  'doc.title': 'requirements 문서',
  'doc.badge': '정제 완료',
  'doc.version': 'v{version}',
  'doc.nextStep':
    '다음은 개발팀 검토예요 — 이 단계는 준비 중이라, 지금은 완성된 문서가 개발팀에 그대로 전달됩니다.',
  'doc.fullyPromotedTitle': '대부분을 개발팀 확인으로 넘겼어요',
  'doc.fullyPromotedNote':
    '이번엔 여쭤본 것 대부분이 개발팀이 정할 몫이라, 제가 그대로 개발팀 확인 항목으로 옮겨 뒀어요. 요청은 그대로 진행됩니다.',
  'doc.completedTitle': '확인이 끝났어요',
  'doc.completedBody':
    '정리한 내용을 전부 확인해 주셨어요. 지금은 여기가 여정의 끝이고, 이 문서가 개발팀에 전달됩니다.',

  // 문서 부분 교정 (#66) — 문서는 끊임없이, 원하는 범위만 고칠 수 있다
  'doc.correctHint': '고칠 곳을 드래그하거나 항목을 누르면 그 자리에서 고칠 수 있어요.',
  'doc.correctSelected': '{count}곳 선택됨',
  'doc.correctModeInstruct': '말로 지시',
  'doc.correctModeEdit': '직접 고치기',
  'doc.correctInstructPlaceholder': '어떻게 고칠까요? (예: 이 항목을 더 구체적으로 써 주세요)',
  'doc.correctEditPlaceholder': '이 자리에 들어갈 내용을 그대로 써 주세요',
  'doc.correctApply': '이 부분 고치기',
  'doc.correctCancel': '취소',
  'doc.correctMultiEditNote': '여러 곳을 선택했어요 — 직접 고치기는 한 곳씩 해 주세요.',
  'doc.correctBack': '뒤로',

  'retry.title': '여기서 멈췄어요',
  'retry.body': '답하신 내용은 저장돼 있어요 — 다시 시도하면 그 답부터 이어서 진행할게요.',
  'retry.staleRound': '다른 창에서 이미 다음 질문으로 넘어갔어요 — 최신 질문을 가져왔어요.',

  'hold.title': '지금은 보류로 정리해 뒀어요',
  'hold.lede':
    '답하신 내용만으로는 정리하기에 부족했어요. 보태 주시면 이 요청이 그 자리에서 다시 진행됩니다 — 지금까지 답하신 건 그대로 남아 있어요.',
  'hold.missing': '부족했던 것: {labels}',
  'hold.placeholder': '보탤 내용을 적어 주세요 — 예: 어떤 팀이 쓰는지, 어떤 문제를 풀고 싶은지',
  'hold.resume': '이어서 보태기',

  'transcript.summary': '지난 대화 {count}건',
  'transcript.expand': '펼치기',
  'transcript.collapse': '접기',
  'transcript.me': '나',
  'transcript.jude': 'Jude',

  'session.notFoundTitle': '요청을 찾을 수 없어요',
  'session.notFoundBody': '링크가 잘못됐거나 서버 저장소가 바뀌었어요.',
  'session.closedTitle': '이 요청은 종결됐어요',
  'session.closedBody': '새 요청은 홈에서 시작하실 수 있어요.',
  'session.errorTitle': '진행하다 막혔어요',
  'session.retryFailed': '다시 시도하지 못했어요',
  'session.actionFailed': '처리하지 못했어요',
  'session.confirmFailed': '확인을 저장하지 못했어요',
} as const;

export type Key = keyof typeof ko;

const en: Record<Key, string> = {
  'brand.sub': 'Request intake',
  'nav.myRequests': 'My requests',
  'nav.newRequest': 'New request',
  'nav.home': 'Home',
  'common.request': 'Request',
  'common.next': 'Next',
  'common.prev': 'Back',
  'common.retry': 'Try again',
  'common.continue': 'Carry on',
  'common.copyLink': 'Copy link',
  'common.copied': 'Copied',
  'common.pending': 'Not built yet',
  'common.dash': '—',

  'intake.title': 'What do you need built?',
  'intake.lede':
    "Leave the request here. I'll ask a few questions and turn it into a requirements document the team can start from.",
  'intake.name': 'Your name (optional)',
  'intake.namePlaceholder': 'Jane Doe',
  'intake.language': '언어 · Language',
  'intake.text': 'Your request',
  'intake.textPlaceholder': 'e.g. We need a dashboard for sales performance',
  'intake.hint': "It doesn't have to be complete — I'll ask about anything unclear.",
  'intake.submit': 'Send request',
  'intake.failed': "I couldn't send that",

  // 자료 첨부 (F1-Attach)
  'attach.label': 'Reference material (optional)',
  'attach.hint':
    'If you already have a brief or a screenshot, add it here — it means fewer questions.',
  'attach.pick': 'Choose a file',
  'attach.uploading': 'Uploading…',
  'attach.remove': 'Remove',
  'attach.limits': 'Up to {mb}MB each, {count} files',
  'attach.rejected': "I couldn't accept this",
  'attach.reading': "I'm reading your material",
  'attach.readFailed': "Material I couldn't read",
  'attach.answerHint': "If it's easier to show than tell, attach something instead.",
  'attach.docTitle': 'Material you sent',
  'attach.docNote': 'Reference only — the document above is what gets built.',
  'attach.download': 'Download',
  'attach.fromFile': 'read from {filename}',

  'home.listNote':
    "This list lives in this browser only — keep each request's link and you can pick it up anywhere.",
  'home.openIssues': '{count} for the team',

  'ack.title': "Got it. I'm drafting the questions now.",
  'ack.eta': 'Usually under a minute, up to two',
  'ack.failedTitle': 'I got stuck drafting the questions',
  'ack.stored': "Request {id} · saved on the server, it won't disappear.",
  'ack.deepLink': "This page's address is the link to your request — it opens anywhere.",

  'wait.intake.1': "I'm taking down the request…",
  'wait.intake.2': "I'm reading it a few different ways…",
  'wait.intake.3': "I'm picking what to ask about…",
  'wait.reply.1': "I'm folding your answers into the requirements…",
  'wait.reply.2': "I'm checking what's still missing…",
  'wait.reply.3': "I'm setting up the next step…",
  'wait.overdue': 'This is taking longer than usual — hang on a little.',
  'wait.elapsed': '{seconds}s elapsed',
  'wait.normalEta': 'Usually tens of seconds, up to two minutes',
  'wait.overdueEta': "If nothing comes back it'll stop on its own shortly",
  'wait.leaveOk':
    'You can leave — come back and it picks up here. Everything is saved on the server.',

  'journey.1': 'Received',
  'journey.2': 'Clarifying',
  'journey.3': 'Document',
  'journey.4': 'Team review',
  'journey.5': 'In progress',
  'journey.aria': 'Request progress',
  'journey.onHold': 'On hold',
  'journey.done': 'Confirmed',

  'chip.intake': 'Drafting questions',
  'chip.clarifying': 'Your turn',
  'chip.documented': 'Document ready — please check',
  'chip.mockup': 'Mockup ready — take a look',
  'chip.onHold': 'On hold — resume anytime',
  'chip.closed': 'Closed',

  'mockup.title': 'Screen mockup',
  'mockup.lede': "I've turned your request into a screen. Click around and see if it matches.",
  'mockup.version': 'Mockup v{version}',
  'mockup.iterationsLeft': '{left} revisions left',
  'mockup.grayscaleNote':
    "It's grayscale for now — colour and mood come after the layout is settled.",
  'mockup.openNew': 'Open full size',
  'mockup.frameTitle': 'Requirements-confirmation mockup',
  'mockup.commentTitle': 'Anything to fix?',
  'mockup.commentPlaceholder': 'e.g. Filters should be period, team and status',
  'mockup.sendComment': 'Send comment — folded into the next round',
  'mockup.annotationsTitle': 'Your comments',
  'mockup.themeTitle': 'Pick a look',
  'mockup.themeLede':
    'Happy with the layout? Tap a look and it dresses the screen above right away — compare on the real screen, then confirm one.',
  'mockup.themePreviewing': 'Previewing: {name}',
  'mockup.themeCommit': 'Go with this look',
  'mockup.themeCurrent': 'Selected',
  'mockup.themeDelegate': 'Let the team decide',
  'mockup.themeDelegated': 'Left the look for the team to decide',
  'mockup.approve': 'Confirm it like this',
  'mockup.approveHint':
    'Confirming folds everything settled on the mockup into a new version of the document.',
  'mockup.approveNeedsTheme': 'Pick a look — or leave it to the team — and you can confirm.',

  'round.title': "Here's what we've pinned down",
  'round.promoted': '(passed to the team)',
  'round.remaining': '{count} still open — {labels}',

  'wizard.roundBadge': 'Round {round}',
  'wizard.lastRound': 'Last round',
  'wizard.progress': 'Question {step} of {total}',
  'wizard.reviewing': 'Review',
  'wizard.lastRoundNote':
    "Anything still unsettled after this round I'll either pass to the team or park as on-hold.",
  'wizard.pickHint': 'Pick one or write your own. "Not sure" is a real answer.',
  'wizard.reviewTitle': "Here's what I'll send",
  'wizard.reviewHint': 'Check it over. Tap a question to change your answer.',
  'wizard.freeChoice': "I'll write my own",
  'wizard.freePlaceholder': 'Your answer',
  'wizard.dontKnowNote': "I'll put this on the team's list — your request keeps moving.",
  'wizard.unanswered': '— not answered',
  'wizard.forTeam': 'For the team',
  'wizard.send': 'Send answers',
  'wizard.freeTitle': 'Add to your request',
  'wizard.freeLede': 'Write whatever you want to add.',
  'wizard.freeInputPlaceholder': 'Anything else I should know',

  'slots.title': 'Does this match what you meant?',
  'slots.lede': 'Confirming each item makes the document more accurate.',
  'slots.confirmed': 'Confirmed ✓',
  'slots.yes': "That's right",
  'slots.no': 'Not quite',
  'slots.correct': 'Correct this',
  'slots.correctPlaceholder': 'What is it actually? Put me right',
  'slots.sendCorrection': 'Send correction',
  'slots.promotedTitle': '{count} for the team to settle',
  'slots.promotedNote': "You don't have to answer these. They get settled in team review.",

  'doc.title': 'Requirements document',
  'doc.badge': 'Refined',
  'doc.version': 'v{version}',
  'doc.nextStep':
    "Next is team review — that stage isn't built yet, so for now the finished document goes to the team as it is.",
  'doc.fullyPromotedTitle': "Most of this went to the team's list",
  'doc.fullyPromotedNote':
    "Most of what I asked turned out to be the team's call, so I moved it straight onto their list. Your request keeps moving.",
  'doc.completedTitle': "That's everything confirmed",
  'doc.completedBody':
    'You checked every item I pinned down. This is the end of the journey for now, and the document goes to the team.',

  // Partial document correction (#66)
  'doc.correctHint': 'Drag over what to fix, or tap an item — you can edit it right there.',
  'doc.correctSelected': '{count} selected',
  'doc.correctModeInstruct': 'Tell me',
  'doc.correctModeEdit': 'Edit directly',
  'doc.correctInstructPlaceholder': 'How should I fix it? (e.g. make this more specific)',
  'doc.correctEditPlaceholder': 'Write exactly what should go here',
  'doc.correctApply': 'Fix this part',
  'doc.correctCancel': 'Cancel',
  'doc.correctMultiEditNote': 'Multiple parts selected — direct editing works one at a time.',
  'doc.correctBack': 'Back',

  'retry.title': 'It stopped here',
  'retry.body': "Your answers are saved — retry and I'll carry on from them.",
  'retry.staleRound':
    'Another window already moved on to the next question — I pulled the latest one.',

  'hold.title': "I've parked this as on-hold",
  'hold.lede':
    "There wasn't enough to work with yet. Add a little and this request picks up right here — everything you answered is still there.",
  'hold.missing': 'What was missing: {labels}',
  'hold.placeholder': 'Add what you can — e.g. which team uses it, what problem it solves',
  'hold.resume': 'Add and resume',

  'transcript.summary': '{count} earlier messages',
  'transcript.expand': 'show',
  'transcript.collapse': 'hide',
  'transcript.me': 'You',
  'transcript.jude': 'Jude',

  'session.notFoundTitle': "I can't find that request",
  'session.notFoundBody': 'The link may be wrong, or the server store changed.',
  'session.closedTitle': 'This request is closed',
  'session.closedBody': 'You can start a new one from home.',
  'session.errorTitle': 'I got stuck',
  'session.retryFailed': "I couldn't retry that",
  'session.actionFailed': "I couldn't process that",
  'session.confirmFailed': "I couldn't save that confirmation",
};

const DICT: Record<Lang, Record<Key, string>> = { ko, en };

/** `{name}` 자리에 값을 끼운다. 없는 자리표시자는 그대로 둔다. */
export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  const raw = DICT[lang][key] ?? DICT.ko[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

const STORAGE_KEY = 'pmjude.lang';

export function isLang(value: unknown): value is Lang {
  return value === 'ko' || value === 'en';
}

/** 인테이크에서 고른 언어를 기억해 둔다 — 세션 없이 여는 화면의 기본값이 된다. */
export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 프라이빗 모드 등 — 기억 못 해도 화면은 동작해야 한다
  }
}

/** 세션의 요청자 언어. 전사의 첫 요청자 발화가 근거다 — 별도 API 필드가 필요 없다. */
export function sessionLang(utterances: readonly Utterance[]): Lang | null {
  const first = utterances.find((u) => u.authorType === 'requester');
  const code = first?.originalLanguage?.slice(0, 2);
  return isLang(code) ? code : null;
}

function browserLang(): Lang {
  if (typeof navigator === 'undefined') return 'ko';
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ko';
}

/**
 * 화면 언어. 우선순위는 세션의 요청자 언어 → 인테이크에서 고른 값 → 브라우저 설정.
 *
 * 첫 페인트는 정적 프리렌더와 맞추기 위해 'ko'로 시작하고, 마운트 후 실제 값으로 정정한다.
 * 명시값(세션 언어)이 있으면 그 즉시 반영되므로 세션 화면에서는 깜빡임이 없다.
 */
function subscribeNothing() {
  // 저장값은 인테이크 폼에서만 바뀌고 그때는 명시값이 내려온다 — 구독할 것이 없다
  return () => {};
}

function clientLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return isLang(stored) ? stored : browserLang();
}

/** 정적 프리렌더 시점의 값 — 클라이언트 스냅샷과 다를 수 있고, React가 알아서 정정한다. */
function serverLang(): Lang {
  return 'ko';
}

export function useLang(explicit?: Lang | null): Lang {
  const resolved = useSyncExternalStore(subscribeNothing, clientLang, serverLang);
  const lang = explicit ?? resolved;
  // <html lang>도 따라간다 — 스크린리더와 하이픈네이션의 근거다
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return lang;
}
