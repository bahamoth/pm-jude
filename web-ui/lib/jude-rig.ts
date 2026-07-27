import { EYE, HEAD, JUDE_STATES, TUNING, type JudeState } from './jude-geometry';

/**
 * Jude 리그 — 하나의 시계로 도는 캐릭터.
 *
 * CSS 키프레임을 쓰지 않는다. 매 프레임 `포즈 + 리듬 + 이벤트 임펄스`를 같은 자리에서
 * 합산해 한 번에 출력하므로 움직임·표정·상호작용이 따로 놀 수 없다. 자세한 설계 근거는
 * docs/persona/jude.md 「표정」.
 *
 * 두 축이 분리되어 있다:
 *   - **반응**(TUNING.react) — 이벤트에 붙는 속도. 이징 계수와 스프링 시간축에 곱한다.
 *   - **재생**(TUNING.play) — 지속 루프의 템포. 별도 시계 PT가 이 배율로 흐른다.
 * 반응을 올린다고 루프가 빨라지지 않고, 루프를 늦춘다고 반응이 굼떠지지 않는다.
 */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ease = (cur: number, tgt: number, rate: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

/** 킥 → 감쇠 진동. 반동·튐·끄덕임·덜컹이 전부 같은 물리를 쓴다. */
class Spring {
  private v = 0;
  private dv = 0;
  constructor(
    private readonly k: number,
    private readonly c: number,
  ) {}
  kick(a: number) {
    this.dv += a;
  }
  step(dt: number) {
    this.dv += (-this.k * this.v - this.c * this.dv) * dt;
    this.v += this.dv * dt;
    return this.v;
  }
}

type Ornament = 'wave' | 'bulb' | 'q' | 'spark' | 'drop';

interface Pose {
  tilt: number;
  sc: number;
  eyes: 'open' | 'flat';
  lid: number;
  esz: number;
  brow: 0 | 1;
  /** [세로 오프셋, 회전] */
  bl: [number, number];
  br: [number, number];
  /** 콧수염 좌우 회전 */
  tl: number;
  tr: number;
  orn: Ornament | null;
  /** 시선 추종 강도 */
  gaze: number;
  rhythm: 'calm' | 'nod' | 'scanStep' | 'cock' | 'smug' | 'panic' | 'freeze';
  /** 고개가 시선을 따라가는 정도의 배율 */
  lean?: number;
  /** 장식 쪽을 올려다보는 고정 편향 */
  gbias?: [number, number];
}

const POSES: Record<JudeState, Pose> = {
  idle: {
    tilt: -4,
    sc: 1,
    eyes: 'open',
    lid: 1,
    esz: 1,
    brow: 0,
    bl: [0, 0],
    br: [0, 0],
    tl: 0,
    tr: 0,
    orn: null,
    gaze: 1,
    rhythm: 'calm',
  },
  listening: {
    tilt: -2,
    sc: 1,
    eyes: 'open',
    lid: 0.66,
    esz: 0.98,
    brow: 1,
    bl: [-0.35, 1.5],
    br: [-0.7, -3],
    tl: 3,
    tr: -3,
    orn: 'wave',
    gaze: 1.3,
    rhythm: 'nod',
    lean: 2.2,
  },
  thinking: {
    tilt: -4,
    sc: 1,
    eyes: 'open',
    lid: 0.7,
    esz: 0.88,
    brow: 1,
    bl: [-0.2, 4],
    br: [-1.7, -9],
    tl: -5,
    tr: 2,
    orn: 'bulb',
    gaze: 0.5,
    rhythm: 'scanStep',
  },
  asking: {
    tilt: 3,
    sc: 1.04,
    eyes: 'open',
    lid: 1,
    esz: 1.24,
    brow: 1,
    bl: [-1.6, 2],
    br: [-2.4, -11],
    tl: -8,
    tr: 8,
    orn: 'q',
    gaze: 1,
    rhythm: 'cock',
    gbias: [0.55, -0.6],
  },
  resolved: {
    tilt: -8,
    sc: 1,
    eyes: 'open',
    lid: 0.34,
    esz: 1.08,
    brow: 1,
    bl: [0.6, 6],
    br: [-2.1, -13],
    tl: -16,
    tr: 4,
    orn: 'spark',
    gaze: 0.35,
    rhythm: 'smug',
  },
  onhold: {
    tilt: 0,
    sc: 1,
    eyes: 'flat',
    lid: 0,
    esz: 1,
    brow: 0,
    bl: [0, 0],
    br: [0, 0],
    tl: 7,
    tr: -7,
    orn: null,
    gaze: 0,
    rhythm: 'freeze',
  },
  failed: {
    tilt: -4,
    sc: 1,
    eyes: 'open',
    lid: 1,
    esz: 1.35,
    brow: 1,
    bl: [-1.6, -17],
    br: [-1.6, 17],
    tl: -22,
    tr: -17,
    orn: 'drop',
    gaze: 0.7,
    rhythm: 'panic',
  },
};

/** 장식별 기본 확대와 바깥으로 밀어내기 — 크게, 그리고 머리에서 떨어뜨린다. */
const ORN_TF: Record<Ornament, { s: number; dx: number; dy: number }> = {
  wave: { s: 1.35, dx: -2.2, dy: 0 },
  bulb: { s: 1.45, dx: 1.6, dy: -1.8 },
  q: { s: 1.35, dx: 1.4, dy: -1.6 },
  spark: { s: 1.5, dx: 1.6, dy: -1.4 },
  drop: { s: 1.45, dx: 1.5, dy: -1.6 },
};

// ── 공유 시계와 커서 ───────────────────────────────────────────────
const rigs = new Set<JudeRig>();
const cursor = { x: 0, y: 0, speed: 0 };
let CLOCK = 0;
let PT = 0;
let raf = 0;
let lastT = 0;
let reducedMotion = false;

function tick(now: number) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  CLOCK += dt;
  PT += dt * TUNING.play;
  cursor.speed = Math.max(0, cursor.speed - dt * 4000);
  for (const r of rigs) if (r.visible) r.frame(dt);
  raf = requestAnimationFrame(tick);
}

function onPointerMove(e: PointerEvent) {
  const dx = e.clientX - cursor.x;
  const dy = e.clientY - cursor.y;
  cursor.speed = Math.max(cursor.speed, Math.hypot(dx, dy) * 60);
  cursor.x = e.clientX;
  cursor.y = e.clientY;
}

function startTicker() {
  if (raf) return;
  cursor.x = window.innerWidth / 2;
  cursor.y = window.innerHeight / 3;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion = mq.matches;
  mq.addEventListener('change', (e) => {
    reducedMotion = e.matches;
  });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  lastT = performance.now();
  raf = requestAnimationFrame(tick);
}

function stopTicker() {
  if (rigs.size) return;
  cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener('pointermove', onPointerMove);
}

export interface JudeRigParts {
  tilt: SVGGElement;
  motion: SVGGElement;
  breathe: SVGGElement;
  eyes: SVGGElement;
  scan: SVGGElement;
  open: SVGEllipseElement[];
  flat: SVGPathElement[];
  browL: SVGPathElement;
  browR: SVGPathElement;
  tashL: SVGPathElement;
  tashR: SVGPathElement;
  orn: Record<Ornament, SVGGElement>;
  waveIn: SVGGElement;
  waveArcs: SVGPathElement[];
  rays: SVGPathElement[];
}

export class JudeRig {
  visible = true;
  private state: JudeState;
  private ornKey: Ornament | null;
  /** 소리의 출처. 있으면 커서보다 우선한다 */
  source: Element | null = null;

  /** 채널 현재값. 매 프레임 목표값으로 이징된다 */
  private readonly c: Record<string, number> = {
    tilt: HEAD.restTilt,
    hx: 0,
    hy: 0,
    mrot: 0,
    sc: 1,
    gx: 0,
    gy: 0,
    lid: 1,
    esz: 1,
    bo: 0,
    bly: 0,
    bla: 0,
    bry: 0,
    bra: 0,
    tl: 0,
    tr: 0,
    orn: 0,
  };
  private readonly sBounce = new Spring(430, 26);
  private readonly sRecoil = new Spring(310, 22);
  private readonly sNod = new Spring(310, 20);
  private readonly sOrn = new Spring(340, 19);
  private readonly sJolt = new Spring(520, 15);

  private perk = 0;
  private startle = 0;
  private flash = 0;
  private hearing = 0;
  private bulbLvl = 0.3;
  private hover = false;
  private blink = 0;
  private blinkQ = 0;
  private nextBlink = 2 + Math.random() * 4;
  private phase = 0;
  private readonly seed = Math.random() * 6.28;
  private attKind: string | null = null;
  private attDx = -1;
  private waveSide = 1;
  private waveLvl = 1;
  private rPulse = 0;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly p: JudeRigParts,
    state: JudeState,
  ) {
    this.state = state;
    this.ornKey = POSES[state].orn;
    rigs.add(this);
    startTicker();
  }

  destroy() {
    rigs.delete(this);
    stopTicker();
  }

  /** 마우스가 올라왔다 / 내려갔다 */
  setHover(on: boolean) {
    this.hover = on;
    if (on) {
      this.queueBlink(1);
      this.jolt(16, 1);
    }
  }

  /** 눌렸다 */
  press() {
    this.sBounce.kick(-15);
    this.queueBlink(2);
    this.startle = Math.max(this.startle, 0.6);
    this.jolt(30, 1);
  }

  /**
   * 소리 한 번 — 음파와 끄덕임이 여기서 동시에 나온다.
   * 출처를 주지 않으면 지금 포커스된 요소를 소리가 나는 곳으로 본다. 요청자가 타이핑하는
   * 입력창이 곧 소리의 출처라 별도 배선이 필요 없다.
   */
  hear(from?: Element | null) {
    this.hearing = 1;
    this.sNod.kick(-4.6);
    this.source = from ?? (typeof document === 'undefined' ? null : document.activeElement);
  }

  setState(s: JudeState) {
    if (s === this.state) return;
    this.state = s;
    this.sRecoil.kick(-9);
    this.queueBlink(1);
    this.phase = 0;
    const next = POSES[s].orn;
    if (next !== this.ornKey) {
      this.ornKey = next;
      this.c.orn = 0;
    }
    if (next) {
      this.sOrn.kick(27);
      this.jolt(12, 1);
    }
  }

  private jolt(v: number, f: number) {
    this.sJolt.kick(v);
    this.flash = Math.max(this.flash, f);
  }

  private queueBlink(n: number) {
    this.blinkQ = Math.max(this.blinkQ, n);
    if (this.blink <= 0) this.blink = 1;
  }

  /** 소리가 그친 뒤에는 출처도 사라진다 — 음파가 멎으면 고개도 커서로 돌아온다. */
  private sourceAt() {
    if (!this.source || this.hearing <= 0) return null;
    const r = this.source.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  frame(dt: number) {
    const pose = POSES[this.state];
    const frozen = pose.rhythm === 'freeze';
    const R = TUNING.react;
    const sdt = dt * R;
    const T = CLOCK;
    const P = PT;
    this.phase += dt;
    this.rPulse = 0;

    // ── 리듬 — 전부 재생 시계에서 파생 ──────────────────────────
    let rTilt = 0;
    let rY = 0;
    let rScan = 0;
    let rSc = 0;
    if (!frozen && !reducedMotion) {
      rSc = Math.sin(P * 1.164) * 0.016;
      if (pose.rhythm === 'nod') {
        const b = P * 5.46;
        rY = (Math.sin(b) * 0.5 + 0.5) * 0.34;
        rTilt = Math.sin(b) * 0.7;
      }
      if (pose.rhythm === 'scanStep') {
        // 뚝뚝 끊기는 이동. 계산하는 기계의 성격
        const SEQ = [-1, 0.62, -0.38, 1, -0.82, 0.28];
        const f = P * 0.72;
        const i = Math.floor(f);
        const u = f - i;
        const a = SEQ[((i % 6) + 6) % 6];
        const b = SEQ[(((i + 1) % 6) + 6) % 6];
        const k = Math.min(1, u * 14);
        rScan = (a + (b - a) * k) * 1.05;
        rTilt = -1.3 + (i % 2 ? 1.1 : -1.1) * k * (i % 3 ? 1 : 0.3);
        // 눈이 옮겨간 뒤 한동안 밝다 — 전구가 여기 반응한다
        this.rPulse = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) * 2.6);
      }
      if (pose.rhythm === 'cock') {
        // 빠르게 갸웃하고 오래 버틴다
        const u = (P / 5.2) % 1;
        const side = u < 0.5 ? 1 : -1;
        const ph = (u % 0.5) / 0.5;
        const k = Math.min(1, ph * 5);
        rTilt = side * 3.1 * k;
        rY = -k * 0.3;
      }
      if (pose.rhythm === 'smug') {
        // 한 방 치고 멈춘다. 정지가 곧 성격
        const u = (P / 4.2) % 1;
        const k = u < 0.34 ? Math.sin(Math.PI * (u / 0.34)) : 0;
        rY = -k * 0.9;
        rTilt = -k * 2.1;
        rSc += k * 0.022;
        this.rPulse = k;
      }
      if (pose.rhythm === 'panic') {
        rTilt = Math.sin(T * 41) * 5 + Math.sin(T * 27) * 2;
        rY = Math.sin(T * 33) * 0.5;
      }
      if (pose.rhythm === 'calm') rY = Math.sin(P * 1.164 + 1) * 0.12;
    }

    // ── 주의 대상 — 눈·고개·장식이 같은 한 점을 본다 ─────────────
    let gx = 0;
    let gy = 0;
    let lean = 0;
    if (!frozen) {
      const r = this.svg.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.44;
      const dcur = Math.hypot(cursor.x - cx, cursor.y - cy) || 1;
      const src = this.sourceAt();
      let ax: number;
      let ay: number;
      let kind: string;
      if (src) {
        ax = src.x;
        ay = src.y;
        kind = 'src';
      } else if (dcur < 620) {
        ax = cursor.x;
        ay = cursor.y;
        kind = 'cursor';
      } else {
        // 아무도 안 부르면 천천히 두리번거린다
        ax = cx + Math.sin(P * 0.37 + this.seed) * 230 + Math.sin(P * 0.21 + this.seed) * 80;
        ay = cy + Math.sin(P * 0.29 + this.seed * 2) * 80;
        kind = 'drift';
      }
      if (kind !== this.attKind) {
        this.attKind = kind;
        this.queueBlink(1);
      }
      const dx = ax - cx;
      const dy = ay - cy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 240) * pose.gaze;
      this.attDx = dx;
      gx = (dx / d) * 1.35 * k;
      gy = (dy / d) * 0.95 * k;
      lean = gx * 0.55 * (pose.lean ?? 1);
      if (pose.gbias) {
        gx += pose.gbias[0];
        gy += pose.gbias[1];
      }
      if (cursor.speed > 1700 && dcur < r.width * 1.6) this.startle = 1;
    }

    // ── 임펄스 ───────────────────────────────────────────────────
    const bounce = this.sBounce.step(sdt);
    const recoil = this.sRecoil.step(sdt);
    const nod = this.sNod.step(sdt);
    const ornSp = this.sOrn.step(sdt);
    const jolt = this.sJolt.step(sdt);
    this.startle = Math.max(0, this.startle - dt * 4.6 * R);
    this.flash = Math.max(0, this.flash - dt * 5.2 * R);
    this.hearing = Math.max(0, this.hearing - dt * 7 * R);
    const perkT = this.hover && !frozen ? 1 : 0;
    // 붙을 땐 빠르게, 풀릴 땐 천천히 — 스냅감의 핵심
    this.perk = ease(this.perk, perkT, (perkT > this.perk ? 34 : 13) * R, dt);

    // ── 깜빡임 — 리듬이 아니라 사건 ──────────────────────────────
    if (!frozen && !reducedMotion) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.queueBlink(1);
        this.nextBlink = 2.6 + Math.random() * 4.4;
      }
    }
    let lidMul = 1;
    if (this.blink > 0) {
      this.blink -= dt * 12 * R;
      lidMul = clamp(1 - Math.sin(Math.PI * clamp(1 - this.blink, 0, 1)) * 0.94, 0.06, 1);
      if (this.blink <= 0) {
        if (this.blinkQ > 1) {
          this.blinkQ--;
          this.blink = 1;
        } else this.blinkQ = 0;
      }
    }

    // ── 목표값 = 포즈 + 리듬 + 임펄스 ────────────────────────────
    const t = {
      tilt: pose.tilt + rTilt + lean * 1.5 + this.perk * 3.5,
      hx: lean * 0.55,
      hy: rY + recoil + nod * 1.6 - this.perk * 0.55,
      mrot: nod * 2.2,
      sc: pose.sc + rSc + bounce * 0.055 - recoil * 0.016 + this.perk * 0.04,
      gx,
      gy,
      lid: pose.eyes === 'open' ? pose.lid : 0,
      esz: pose.esz * (1 + this.startle * 0.28 + this.perk * 0.1),
      bo: pose.brow || this.perk > 0.04 || this.startle > 0.04 ? 1 : 0,
      bly: pose.bl[0] - this.perk * 1.1 - this.startle * 1.2,
      bla: pose.bl[1] + this.perk * 3,
      bry: pose.br[0] - this.perk * 1.1 - this.startle * 1.2,
      bra: pose.br[1] - this.perk * 3,
      tl: pose.tl - this.perk * 5 - nod * 3,
      tr: pose.tr + this.perk * 5 + nod * 3,
    };
    if (reducedMotion) {
      t.tilt = pose.tilt;
      t.hx = t.hy = t.mrot = 0;
      t.sc = pose.sc;
      t.gx = t.gy = 0;
    }

    // ── 이징 — 전 채널 동일 파이프라인 ───────────────────────────
    const c = this.c;
    const E = (reducedMotion ? 999 : 1) * R;
    c.tilt = ease(c.tilt, t.tilt, 21 * E, dt);
    c.hx = ease(c.hx, t.hx, 23 * E, dt);
    c.hy = ease(c.hy, t.hy, 32 * E, dt);
    c.mrot = ease(c.mrot, t.mrot, 32 * E, dt);
    c.sc = ease(c.sc, t.sc, 28 * E, dt);
    c.gx = ease(c.gx, t.gx, 16 * E, dt); // 시선만 살짝 늦게 — 완전히 붙으면 기계로 보인다
    c.gy = ease(c.gy, t.gy, 16 * E, dt);
    c.lid = ease(c.lid, t.lid, 36 * E, dt);
    c.esz = ease(c.esz, t.esz, 32 * E, dt);
    c.bo = ease(c.bo, t.bo, 28 * E, dt);
    c.bly = ease(c.bly, t.bly, 26 * E, dt);
    c.bla = ease(c.bla, t.bla, 26 * E, dt);
    c.bry = ease(c.bry, t.bry, 26 * E, dt);
    c.bra = ease(c.bra, t.bra, 26 * E, dt);
    c.tl = ease(c.tl, t.tl, 26 * E, dt);
    c.tr = ease(c.tr, t.tr, 26 * E, dt);
    c.orn = ease(c.orn, this.ornKey ? 1 : 0, 30 * E, dt);

    // ── 출력 ─────────────────────────────────────────────────────
    const p = this.p;
    p.tilt.style.transform = `rotate(${c.tilt.toFixed(2)}deg)`;
    p.motion.style.transform = `translate(${c.hx.toFixed(2)}px,${c.hy.toFixed(2)}px) rotate(${c.mrot.toFixed(2)}deg)`;
    p.breathe.style.transform = `scale(${c.sc.toFixed(3)})`;
    p.eyes.style.transform = frozen
      ? 'translate(0,0)'
      : `translate(${c.gx.toFixed(2)}px,${c.gy.toFixed(2)}px)`;
    p.scan.style.transform = `translateX(${rScan.toFixed(2)}px)`;

    const openShown = pose.eyes === 'open';
    const ry = Math.max(0.16, EYE.r * c.esz * c.lid * lidMul);
    for (const e of p.open) {
      e.setAttribute('rx', (EYE.r * c.esz).toFixed(2));
      e.setAttribute('ry', ry.toFixed(2));
      e.style.opacity = openShown ? '1' : '0';
    }
    for (const e of p.flat) e.style.opacity = openShown ? '0' : '1';

    p.browL.style.opacity = String(c.bo);
    p.browR.style.opacity = String(c.bo);
    p.browL.style.transform = `translateY(${c.bly.toFixed(2)}px) rotate(${c.bla.toFixed(2)}deg)`;
    p.browR.style.transform = `translateY(${c.bry.toFixed(2)}px) rotate(${c.bra.toFixed(2)}deg)`;
    const tashY = (-nod * 0.5).toFixed(2);
    p.tashL.style.transform = `rotate(${c.tl.toFixed(2)}deg) translateY(${tashY}px)`;
    p.tashR.style.transform = `rotate(${c.tr.toFixed(2)}deg) translateY(${tashY}px)`;

    // ── 장식 — 원인이 있을 때만. 주기 점멸은 쓰지 않는다 ─────────
    for (const k of Object.keys(p.orn) as Ornament[]) {
      if (k !== this.ornKey) p.orn[k].style.opacity = '0';
    }
    if (!this.ornKey) return;
    const g = p.orn[this.ornKey];
    const tf = ORN_TF[this.ornKey];
    const pop = tf.s * (0.5 + 0.5 * c.orn) * (1 + ornSp * 0.13);
    g.style.opacity = String(c.orn);

    if (this.ornKey === 'wave') {
      // 소리 나는 쪽 귀에 붙고, 소스가 있으면 진짜 소리에 붙는다
      this.waveSide = ease(this.waveSide, this.attDx > 0 ? -1 : 1, 6 * R, dt);
      this.waveLvl = Math.max(this.source ? this.hearing : 1, this.flash);
      g.style.transform = `scaleX(${this.waveSide.toFixed(3)})`;
      p.waveIn.style.transform = `translateX(${tf.dx}px) scale(${(pop * (0.62 + 0.38 * this.waveLvl)).toFixed(3)})`;
      p.waveArcs.forEach((a, i) => {
        const u = (((P * 1.02 - i * 0.17) % 1) + 1) % 1;
        a.style.opacity = (Math.sin(Math.PI * u) * 0.95 * c.orn * this.waveLvl).toFixed(3);
        a.style.transform = `translateX(${(0.8 - u * 1.9).toFixed(2)}px)`;
      });
    } else if (this.ornKey === 'bulb') {
      // 전등 스위치처럼 — 올려두면 켜져 있고, 손 떼면 필라멘트가 식듯 꺼진다
      const bulbT = Math.max(0.3, this.hover ? 1 : 0, this.rPulse * 0.72, this.flash);
      this.bulbLvl = ease(this.bulbLvl, bulbT, (bulbT > this.bulbLvl ? 44 : 6.5) * R, dt);
      const f = this.bulbLvl;
      g.style.opacity = (c.orn * f).toFixed(3);
      g.style.transform = `translate(${tf.dx}px,${tf.dy}px) scale(${(pop * (1 + jolt * 0.09)).toFixed(3)}) rotate(${(jolt * 9).toFixed(2)}deg)`;
      const rf = Math.max(0, (f - 0.5) * 2);
      for (const r of p.rays) {
        r.style.opacity = rf.toFixed(2);
        r.style.transform = `scale(${(0.55 + rf * 0.6).toFixed(2)})`;
      }
    } else if (this.ornKey === 'q') {
      const qu = (P / 5.2) % 1;
      const qk = Math.min(1, ((qu % 0.5) / 0.5) * 5);
      const rot = (qu < 0.5 ? 1 : -1) * qk * -7 + jolt * 26;
      g.style.transform =
        `translate(${(tf.dx + jolt * 1.1).toFixed(2)}px,${(tf.dy + qk * -2.1 - jolt * 2.4).toFixed(2)}px) ` +
        `rotate(${rot.toFixed(2)}deg) scale(${(pop * (1 + qk * 0.16) * (1 + jolt * 0.1)).toFixed(3)})`;
    } else if (this.ornKey === 'spark') {
      // 상시 느린 명멸(2.8초) — 끊기지 않는다. 그 위에 원인이 얹힌다
      const twBase = 0.58 + 0.42 * (0.5 - 0.5 * Math.cos(P * 2.24));
      const tw = Math.max(twBase, this.hover ? 1 : 0, this.rPulse, this.flash);
      g.style.opacity = (c.orn * tw).toFixed(3);
      g.style.transform =
        `translate(${tf.dx}px,${tf.dy}px) scale(${(pop * (0.84 + tw * 0.26) * (1 + jolt * 0.16)).toFixed(3)}) ` +
        `rotate(${((tw - 0.6) * 26 + jolt * 34).toFixed(2)}deg)`;
    } else {
      const u = (P * 0.42) % 1;
      g.style.opacity = (c.orn * Math.min(1, Math.sin(Math.PI * u) * 1.6)).toFixed(3);
      g.style.transform =
        `translate(${(tf.dx + jolt * 1.6).toFixed(2)}px,${(tf.dy + u * 3.6 - 1.4).toFixed(2)}px) ` +
        `scale(${(pop * (0.8 + u * 0.25)).toFixed(3)}) rotate(${(jolt * 12).toFixed(2)}deg)`;
    }
  }
}

export { JUDE_STATES };
