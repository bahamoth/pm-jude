import type { SessionStatus } from './types';

/**
 * Jude의 지오메트리와 표정 상태. 정본 명세는 docs/persona/jude.md.
 *
 * 여기 있는 경로 문자열은 web-ui/public/jude.svg 와 같아야 한다 —
 * jude-geometry.test.ts 가 대조한다. 정적 자산과 컴포넌트가 갈라지면 즉시 실패한다.
 */

/** 말풍선 겸 얼굴. 32×32 격자, 꼬리는 왼쪽 아래. */
export const BUBBLE_PATH =
  'M12.5 4.5H19.5A8.5 8.5 0 0 1 28 13V14A8.5 8.5 0 0 1 19.5 22.5H15.5L9.3 28L12.5 22.5A8.5 8.5 0 0 1 4 14V13A8.5 8.5 0 0 1 12.5 4.5Z';

/** 콧수염 — 닫는 중괄호를 시계방향 90° 돌린 것. 좌우가 따로 움직인다. */
export const TASH_LEFT_PATH =
  'M15.3 16.8C14.3 16.8 13.8 17.3 13.1 17.9 12.4 18.5 11.7 18.9 10.9 18.7 10.5 18.6 10.35 18.25 10.45 17.85';
export const TASH_RIGHT_PATH =
  'M17.7 16.8C18.7 16.8 19.2 17.3 19.9 17.9 20.6 18.5 21.3 18.9 22.1 18.7 22.5 18.6 22.65 18.25 22.55 17.85';

export const BROW_LEFT_PATH = 'M10.7 9.4Q13 8.4 15.3 9.4';
export const BROW_RIGHT_PATH = 'M17.7 9.4Q20 8.4 22.3 9.4';

/** 눈 — 중심 x=16.5. 말풍선 중심보다 0.5 오른쪽이며 왼쪽 아래 꼬리와 균형을 맞춘다. */
export const EYE = { left: 13, right: 20, cy: 12.4, r: 1.9 } as const;

/** 확정 수치 (프로토타입에서 운영자가 고른 값). */
export const TUNING = {
  /** 콧수염 가로 배율 */
  tashWidth: 1.2,
  /** 인중 간격 — 좌우 반쪽이 각각 이만큼 벌어진다 */
  tashGap: 0.2,
  /** 콧수염 선 굵기 */
  tashStroke: 1.8,
  /** 이벤트 반응 배율. 이징 계수와 스프링 시간축에 곱한다 */
  react: 1.35,
  /** 지속 루프 재생 배율 */
  play: 1,
} as const;

/** 머리 기울기 기준점과 기본 각도. */
export const HEAD = { originX: 16, originY: 15, restTilt: -4 } as const;

/** 장식이 필요한 여백까지 포함한 표시 박스. */
export const VIEWBOX = '-8.5 -12 46 46';
/**
 * 박스 대비 머리의 비율. 장식(전구·물음표·음파)이 머리 밖에 떠 있어야 하므로
 * 박스가 머리보다 훨씬 크다 — `size`(박스 픽셀)에 이 값을 곱해야 실제 머리 크기가 나온다.
 * 콧수염과 눈썹은 머리 28px 아래에서 뭉개진다: size는 최소 54를 준다.
 */
export const HEAD_RATIO = 24 / 46;
/** 장식 없는 축약형(파비콘)용 박스. */
export const VIEWBOX_MARK = '0 0 32 32';

export const JUDE_STATES = [
  'idle',
  'listening',
  'thinking',
  'asking',
  'resolved',
  'onhold',
  'failed',
] as const;
export type JudeState = (typeof JUDE_STATES)[number];

export interface JudeStateInput {
  status: SessionStatus;
  terminalState: string | null;
  /** 서버가 이 세션의 LLM 라운드를 돌리는 중인가 */
  processing: boolean;
  /** 요청자가 지금 입력 중인가 — 화면 로컬 신호 */
  typing?: boolean;
  /** 라운드 생성이 실패해 재시도를 기다리는 중인가 */
  failed?: boolean;
}

/**
 * 세션 상태 → 표정. 우선순위는 실패 > 입력 중 > 서버 처리 중 > 세션 상태 순이다.
 *
 * 「입력 중」이 「처리 중」보다 앞서는 이유: 서버가 도는 동안 입력창은 비활성이라
 * 둘이 동시에 참일 수 없고, 참이 되는 경우라면 요청자의 직접 행동이 우선한다.
 */
export function judeState(input: JudeStateInput): JudeState {
  if (input.failed) return 'failed';
  if (input.typing) return 'listening';
  if (input.processing) return 'thinking';
  switch (input.status) {
    case 'intake':
      return 'thinking';
    case 'clarifying':
      return 'asking';
    case 'documented':
      return 'resolved';
    case 'mockup':
      return 'asking'; // 목업 확인은 요청자 차례다 — 코멘트·선정·확정을 기다린다 (F4)
    case 'closed':
      return input.terminalState === 'on_hold_insufficient_info' ? 'onhold' : 'resolved';
  }
}
