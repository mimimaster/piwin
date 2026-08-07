import type { CSSProperties, ReactElement } from 'react';

/* ──────────────────────────────────────────────────────────────
 * Breathing animation primitives.
 *
 * These are pure-CSS decorative animations that use the semantic
 * `--text` color variable, so they automatically adapt to the
 * active light/dark theme without any JavaScript theme awareness.
 *
 * All animations respect `prefers-reduced-motion` (see primitives.css).
 * ────────────────────────────────────────────────────────────── */

export type AnimationSize = 'sm' | 'md' | 'lg';

export type BreathDotProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type PulseBlockProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type SolidBarsProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type OrganicBlobProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type BreathMatrixProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type RadialBellowProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type CascadeRippleProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

export type AsteriskBreathProps = {
  size?: AnimationSize;
  label?: string;
  testId?: string;
};

const SIZE_CLASS: Record<AnimationSize, string> = {
  sm: 'ui-anim--sm',
  md: 'ui-anim--md',
  lg: 'ui-anim--lg',
};

/** CSS custom-property style object — React's CSSProperties does not
 *  allow arbitrary `--*` keys, so we widen with an index signature. */
type CustomProps = CSSProperties & Record<`--${string}`, string | number>;

/** 圆点呼吸 — a single dot that rhythmically scales and fades. */
export function BreathDot(props: BreathDotProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-breath-dot ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'breathing dot'}
      data-testid={props.testId ?? 'breath-dot'}
    >
      <span className="ui-anim-breath-dot__core" />
    </span>
  );
}

/** 方块脉冲 — a 3×3 grid of blocks that pulse in a diagonal wave. */
export function PulseBlock(props: PulseBlockProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-pulse-block ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'pulse block'}
      data-testid={props.testId ?? 'pulse-block'}
    >
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.2s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.4s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.2s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.4s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.6s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.4s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.6s' }} />
      <span className="ui-anim-pulse-block__cell" style={{ animationDelay: '0.8s' }} />
    </span>
  );
}

/** 条形呼吸 — five vertical bars that breathe in sequence. */
export function SolidBars(props: SolidBarsProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-solid-bars ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'solid bars'}
      data-testid={props.testId ?? 'solid-bars'}
    >
      <span className="ui-anim-solid-bars__bar" style={{ animationDelay: '0s' }} />
      <span className="ui-anim-solid-bars__bar" style={{ animationDelay: '0.15s' }} />
      <span className="ui-anim-solid-bars__bar" style={{ animationDelay: '0.3s' }} />
      <span className="ui-anim-solid-bars__bar" style={{ animationDelay: '0.45s' }} />
      <span className="ui-anim-solid-bars__bar" style={{ animationDelay: '0.6s' }} />
    </span>
  );
}

/** 变形有机体 — a morphing blob with organic border-radius breathing. */
export function OrganicBlob(props: OrganicBlobProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-organic-blob ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'organic blob'}
      data-testid={props.testId ?? 'organic-blob'}
    >
      <span className="ui-anim-organic-blob__shape" />
    </span>
  );
}

/** Pre-computed CSS custom properties for the 4×4 matrix grid.
 *  Each cell carries its row (--i) and column (--j) index so the
 *  CSS animation-delay can compute a diagonal wave. */
const MATRIX_CELL_STYLES: readonly CustomProps[] = [
  { '--i': 0, '--j': 0 }, { '--i': 0, '--j': 1 }, { '--i': 0, '--j': 2 }, { '--i': 0, '--j': 3 },
  { '--i': 1, '--j': 0 }, { '--i': 1, '--j': 1 }, { '--i': 1, '--j': 2 }, { '--i': 1, '--j': 3 },
  { '--i': 2, '--j': 0 }, { '--i': 2, '--j': 1 }, { '--i': 2, '--j': 2 }, { '--i': 2, '--j': 3 },
  { '--i': 3, '--j': 0 }, { '--i': 3, '--j': 1 }, { '--i': 3, '--j': 2 }, { '--i': 3, '--j': 3 },
] as const;

/** 呼吸矩阵 — a 4×4 grid of cells pulsing in a diagonal wave. */
export function BreathMatrix(props: BreathMatrixProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-breath-matrix ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'breath matrix'}
      data-testid={props.testId ?? 'breath-matrix'}
    >
      {MATRIX_CELL_STYLES.map((cellStyle, idx) => (
        <span key={idx} className="ui-anim-breath-matrix__cell" style={cellStyle} />
      ))}
    </span>
  );
}

/** Pre-computed CSS custom properties for the 8 radial vanes.
 *  Each vane carries its index (--i) so the CSS can compute rotation
 *  and animation-delay. */
const BELLOW_VANE_STYLES: readonly CustomProps[] = [
  { '--i': 0 }, { '--i': 1 }, { '--i': 2 }, { '--i': 3 },
  { '--i': 4 }, { '--i': 5 }, { '--i': 6 }, { '--i': 7 },
] as const;

/** 辐射风箱 — 8 radial vanes that breathe in and out from center. */
export function RadialBellow(props: RadialBellowProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-radial-bellow ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'radial bellow'}
      data-testid={props.testId ?? 'radial-bellow'}
    >
      {BELLOW_VANE_STYLES.map((vaneStyle, idx) => (
        <span key={idx} className="ui-anim-radial-bellow__vane" style={vaneStyle} />
      ))}
    </span>
  );
}

/** Pre-computed CSS custom properties for the 10 horizontal bars.
 *  Each bar carries its index (--i) for cascading animation-delay. */
const RIPPLE_BAR_STYLES: readonly CustomProps[] = [
  { '--i': 0 }, { '--i': 1 }, { '--i': 2 }, { '--i': 3 }, { '--i': 4 },
  { '--i': 5 }, { '--i': 6 }, { '--i': 7 }, { '--i': 8 }, { '--i': 9 },
] as const;

/** 级联涟漪 — 10 horizontal bars that cascade in a breathing wave. */
export function CascadeRipple(props: CascadeRippleProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-cascade-ripple ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'cascade ripple'}
      data-testid={props.testId ?? 'cascade-ripple'}
    >
      {RIPPLE_BAR_STYLES.map((barStyle, idx) => (
        <span key={idx} className="ui-anim-cascade-ripple__bar" style={barStyle} />
      ))}
    </span>
  );
}

/** Pre-computed CSS custom properties for the 4 asterisk arms.
 *  Each arm carries its index (--i) for staggered animation-delay. */
const ASTERISK_ARM_STYLES: readonly CustomProps[] = [
  { '--i': 0 }, { '--i': 1 }, { '--i': 2 }, { '--i': 3 },
] as const;

/** 星芒呼吸 — four rotating asterisk arms that breathe around a core dot. */
export function AsteriskBreath(props: AsteriskBreathProps): ReactElement {
  const size = props.size ?? 'md';
  return (
    <span
      className={`ui-anim-asterisk ${SIZE_CLASS[size]}`}
      role="img"
      aria-label={props.label ?? 'asterisk breath'}
      data-testid={props.testId ?? 'asterisk-breath'}
    >
      <svg className="ui-anim-asterisk__icon" viewBox="0 0 48 48" aria-hidden="true">
        <g className="ui-anim-asterisk__spinner">
          <g transform="rotate(0 24 24)">
            <rect className="ui-anim-asterisk__arm" style={ASTERISK_ARM_STYLES[0]} x="21.5" y="7" width="5" height="34" rx="2.5" />
          </g>
          <g transform="rotate(45 24 24)">
            <rect className="ui-anim-asterisk__arm" style={ASTERISK_ARM_STYLES[1]} x="21.5" y="7" width="5" height="34" rx="2.5" />
          </g>
          <g transform="rotate(90 24 24)">
            <rect className="ui-anim-asterisk__arm" style={ASTERISK_ARM_STYLES[2]} x="21.5" y="7" width="5" height="34" rx="2.5" />
          </g>
          <g transform="rotate(135 24 24)">
            <rect className="ui-anim-asterisk__arm" style={ASTERISK_ARM_STYLES[3]} x="21.5" y="7" width="5" height="34" rx="2.5" />
          </g>
        </g>
        <circle className="ui-anim-asterisk__core" cx="24" cy="24" r="2.5" />
      </svg>
    </span>
  );
}

/** Catalog metadata for the animation showcase page. */
export type AnimationCatalogEntry = {
  id: string;
  component: ReactElement;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
};

export const ANIMATION_CATALOG: readonly AnimationCatalogEntry[] = [
  {
    id: 'breath-dot',
    component: <BreathDot size="lg" />,
    nameZh: '圆点呼吸',
    nameEn: 'Breath Dot',
    descZh: '单点缩放渐隐，节奏舒缓',
    descEn: 'Single dot scaling and fading in a calm rhythm',
  },
  {
    id: 'pulse-block',
    component: <PulseBlock size="lg" />,
    nameZh: '方块脉冲',
    nameEn: 'Pulse Block',
    descZh: '3×3 方格对角线波纹脉冲',
    descEn: '3×3 grid pulsing in a diagonal wave',
  },
  {
    id: 'solid-bars',
    component: <SolidBars size="lg" />,
    nameZh: '条形呼吸',
    nameEn: 'Solid Bars',
    descZh: '五根竖条依次呼吸起伏',
    descEn: 'Five vertical bars breathing in sequence',
  },
  {
    id: 'organic-blob',
    component: <OrganicBlob size="lg" />,
    nameZh: '变形有机体',
    nameEn: 'Organic Blob',
    descZh: '超椭圆扭动 · 流体呼吸',
    descEn: 'Morphing superellipse with fluid breathing',
  },
  {
    id: 'breath-matrix',
    component: <BreathMatrix size="lg" />,
    nameZh: '呼吸矩阵',
    nameEn: 'Breath Matrix',
    descZh: '4×4 波浪脉动 · 隔膜式呼吸',
    descEn: '4×4 grid wave pulse, diaphragm-like breathing',
  },
  {
    id: 'radial-bellow',
    component: <RadialBellow size="lg" />,
    nameZh: '辐射风箱',
    nameEn: 'Radial Bellow',
    descZh: '涡轮叶片 · 聚散呼吸',
    descEn: 'Turbine vanes converging and diverging',
  },
  {
    id: 'cascade-ripple',
    component: <CascadeRipple size="lg" />,
    nameZh: '级联涟漪',
    nameEn: 'Cascade Ripple',
    descZh: '横条起伏 · 胸腔式呼吸',
    descEn: 'Horizontal bars cascading, thoracic breathing',
  },
  {
    id: 'asterisk-breath',
    component: <AsteriskBreath size="lg" />,
    nameZh: '星芒呼吸',
    nameEn: 'Asterisk Breath',
    descZh: '四臂星芒旋转 · 核心同步呼吸',
    descEn: 'Four asterisk arms rotating with a breathing core',
  },
] as const;
