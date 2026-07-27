'use client';

import { useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import {
  BROW_LEFT_PATH,
  BROW_RIGHT_PATH,
  BUBBLE_PATH,
  EYE,
  HEAD,
  TASH_LEFT_PATH,
  TASH_RIGHT_PATH,
  TUNING,
  VIEWBOX,
  type JudeState,
} from '@/lib/jude-geometry';
import { JudeRig, type JudeRigParts } from '@/lib/jude-rig';
import { cn } from '@/lib/utils';

export interface JudeHandle {
  /**
   * 소리 한 번 — 음파가 뜨고 고개가 끄덕이며 소리 나는 쪽을 본다. 키 입력마다 부른다.
   * 출처를 생략하면 지금 포커스된 요소를 쓴다.
   */
  hear(from?: Element | null): void;
}

interface Props {
  state: JudeState;
  /**
   * SVG 박스의 픽셀 크기 — 머리가 아니라 박스다. 장식이 머리 밖에 뜨므로 실제 머리는
   * `size * HEAD_RATIO`(약 52%)다. 머리가 28px 아래로 내려가면 콧수염·눈썹이 뭉개지니
   * 54 미만으로는 쓰지 않는다. 더 작아야 하면 public/jude-mark.svg를 쓴다.
   */
  size?: number;
  ref?: RefObject<JudeHandle | null>;
  className?: string;
  /** 장식 없이 얼굴만 — 좁은 자리용 */
  bare?: boolean;
}

/**
 * Jude — 세션 상태에 반응하는 아바타. 정본 명세는 docs/persona/jude.md.
 *
 * 모든 움직임은 lib/jude-rig.ts의 리그가 준다. 여기서는 구조만 그리고 ref를 넘긴다.
 * 색은 전부 currentColor라 부모의 텍스트 색을 그대로 받는다 — 공용 자산인
 * public/jude.svg의 `.jude-asset` 클래스는 여기 붙이지 않는다(색이 고정된다).
 */
export function Jude({ state, size = 56, ref, className, bare = false }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rigRef = useRef<JudeRig | null>(null);
  const tiltRef = useRef<SVGGElement>(null);
  const motionRef = useRef<SVGGElement>(null);
  const breatheRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const scanRef = useRef<SVGGElement>(null);
  const browLRef = useRef<SVGPathElement>(null);
  const browRRef = useRef<SVGPathElement>(null);
  const tashLRef = useRef<SVGPathElement>(null);
  const tashRRef = useRef<SVGPathElement>(null);
  const waveInRef = useRef<SVGGElement>(null);

  useImperativeHandle(
    ref,
    () => ({ hear: (from?: Element | null) => rigRef.current?.hear(from) }),
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const q = <T extends Element>(sel: string) => svg.querySelector(sel) as T;
    const qa = <T extends Element>(sel: string) => [...svg.querySelectorAll(sel)] as T[];
    const parts: JudeRigParts = {
      tilt: tiltRef.current!,
      motion: motionRef.current!,
      breathe: breatheRef.current!,
      eyes: eyesRef.current!,
      scan: scanRef.current!,
      open: qa<SVGEllipseElement>('[data-j="open"]'),
      flat: qa<SVGPathElement>('[data-j="flat"]'),
      browL: browLRef.current!,
      browR: browRRef.current!,
      tashL: tashLRef.current!,
      tashR: tashRRef.current!,
      orn: {
        wave: q<SVGGElement>('[data-o="wave"]'),
        bulb: q<SVGGElement>('[data-o="bulb"]'),
        q: q<SVGGElement>('[data-o="q"]'),
        spark: q<SVGGElement>('[data-o="spark"]'),
        drop: q<SVGGElement>('[data-o="drop"]'),
      },
      waveIn: waveInRef.current!,
      waveArcs: qa<SVGPathElement>('[data-o="wave"] path'),
      rays: qa<SVGPathElement>('[data-ray]'),
    };
    const rig = new JudeRig(svg, parts, state);
    rigRef.current = rig;

    // 화면 밖 리그는 쉰다
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => (rig.visible = e.isIntersecting)),
      {
        rootMargin: '80px',
      },
    );
    io.observe(svg);
    return () => {
      io.disconnect();
      rig.destroy();
      rigRef.current = null;
    };
    // 리그는 한 번만 만든다. state·source 변경은 아래 이펙트가 반영한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rigRef.current?.setState(state);
  }, [state]);

  const O = {
    transformBox: 'view-box',
    transformOrigin: `${HEAD.originX}px ${HEAD.originY}px`,
  } as const;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={VIEWBOX}
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label="Jude"
      className={cn('block shrink-0 overflow-visible', className)}
      onPointerEnter={() => rigRef.current?.setHover(true)}
      onPointerLeave={() => rigRef.current?.setHover(false)}
      onPointerDown={() => rigRef.current?.press()}
    >
      {!bare && (
        <g>
          <g
            data-o="wave"
            style={{ transformBox: 'view-box', transformOrigin: '16px 12.5px', opacity: 0 }}
          >
            <g ref={waveInRef} style={{ transformBox: 'view-box', transformOrigin: '0px 12.5px' }}>
              <path
                d="M1.2 10A4 4 0 0 0 1.2 15"
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{ transformBox: 'view-box' }}
              />
              <path
                d="M-0.5 9A6 6 0 0 0 -0.5 16"
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{ transformBox: 'view-box' }}
              />
              <path
                d="M-2.2 8A8 8 0 0 0 -2.2 17"
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{ transformBox: 'view-box' }}
              />
            </g>
          </g>
          <g
            data-o="bulb"
            style={{ transformBox: 'view-box', transformOrigin: '25.2px -1.6px', opacity: 0 }}
          >
            <circle cx="25.2" cy="-1.6" r="2.4" strokeWidth="1.5" />
            <path d="M23.9 1H26.5" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M24.3 2.2H26.1" strokeWidth="1.5" strokeLinecap="round" />
            <path
              data-ray
              d="M25.2-5V-5.9"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ transformBox: 'view-box', transformOrigin: '25.2px -1.6px' }}
            />
            <path
              data-ray
              d="M21.9-3.9 21.1-4.7"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ transformBox: 'view-box', transformOrigin: '25.2px -1.6px' }}
            />
            <path
              data-ray
              d="M28.5-3.9 29.3-4.7"
              strokeWidth="1.5"
              strokeLinecap="round"
              style={{ transformBox: 'view-box', transformOrigin: '25.2px -1.6px' }}
            />
          </g>
          <g
            data-o="q"
            style={{ transformBox: 'view-box', transformOrigin: '27.2px -1.8px', opacity: 0 }}
          >
            <path
              d="M24.7-2.6C24.7-4.7 26-5.7 27.4-5.7 28.8-5.7 29.8-4.8 29.8-3.6 29.8-2.1 28.5-1.7 27.9-1 27.6-.6 27.5-.2 27.5.3"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <circle cx="27.5" cy="2.1" r="0.9" fill="currentColor" stroke="none" />
          </g>
          <g
            data-o="spark"
            style={{ transformBox: 'view-box', transformOrigin: '25.9px -0.1px', opacity: 0 }}
          >
            <path
              d="M25.9-3.6L26.9-1.1L29.4-.1L26.9.9L25.9 3.4L24.9.9L22.4-.1L24.9-1.1Z"
              fill="currentColor"
              stroke="none"
            />
            <path
              d="M30.1 2.2L30.5 3.3L31.6 3.7L30.5 4.1L30.1 5.2L29.7 4.1L28.6 3.7L29.7 3.3Z"
              fill="currentColor"
              stroke="none"
            />
          </g>
          <g
            data-o="drop"
            style={{ transformBox: 'view-box', transformOrigin: '26.4px -0.4px', opacity: 0 }}
          >
            <path
              d="M26.4-4C26.4-4 29.1-.8 29.1.8 29.1 2.2 27.9 3.2 26.4 3.2 24.9 3.2 23.7 2.2 23.7.8 23.7-.8 26.4-4 26.4-4Z"
              fill="currentColor"
              stroke="none"
            />
          </g>
        </g>
      )}

      <g ref={tiltRef} style={O}>
        <g ref={motionRef} style={O}>
          <g ref={breatheRef} style={O}>
            <path d={BUBBLE_PATH} strokeWidth="2.3" strokeLinejoin="round" />
            <path
              ref={browLRef}
              d={BROW_LEFT_PATH}
              strokeWidth="1.7"
              strokeLinecap="round"
              style={{ transformBox: 'view-box', transformOrigin: '13px 9px', opacity: 0 }}
            />
            <path
              ref={browRRef}
              d={BROW_RIGHT_PATH}
              strokeWidth="1.7"
              strokeLinecap="round"
              style={{ transformBox: 'view-box', transformOrigin: '20px 9px', opacity: 0 }}
            />
            <g ref={eyesRef}>
              <g
                ref={scanRef}
                style={{ transformBox: 'view-box', transformOrigin: '16.5px 12.4px' }}
              >
                <ellipse
                  data-j="open"
                  cx={EYE.left}
                  cy={EYE.cy}
                  rx={EYE.r}
                  ry={EYE.r}
                  fill="currentColor"
                  stroke="none"
                  style={{ transformBox: 'view-box' }}
                />
                <ellipse
                  data-j="open"
                  cx={EYE.right}
                  cy={EYE.cy}
                  rx={EYE.r}
                  ry={EYE.r}
                  fill="currentColor"
                  stroke="none"
                  style={{ transformBox: 'view-box' }}
                />
                <path
                  data-j="flat"
                  d="M11.1 12.4H14.9"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  style={{ opacity: 0 }}
                />
                <path
                  data-j="flat"
                  d="M18.1 12.4H21.9"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  style={{ opacity: 0 }}
                />
              </g>
            </g>
            <g
              style={{
                transformBox: 'view-box',
                transformOrigin: '16.5px 17.8px',
                transform: `scaleX(${TUNING.tashWidth})`,
              }}
            >
              <g style={{ transform: `translateX(${-TUNING.tashGap}px)` }}>
                <path
                  ref={tashLRef}
                  d={TASH_LEFT_PATH}
                  strokeWidth={TUNING.tashStroke}
                  strokeLinecap="round"
                  style={{ transformBox: 'view-box', transformOrigin: '15.3px 16.8px' }}
                />
              </g>
              <g style={{ transform: `translateX(${TUNING.tashGap}px)` }}>
                <path
                  ref={tashRRef}
                  d={TASH_RIGHT_PATH}
                  strokeWidth={TUNING.tashStroke}
                  strokeLinecap="round"
                  style={{ transformBox: 'view-box', transformOrigin: '17.7px 16.8px' }}
                />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
