import type { ReactElement } from 'react';

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

const SIZE_CLASS: Record<AnimationSize, string> = {
  sm: 'ui-anim--sm',
  md: 'ui-anim--md',
  lg: 'ui-anim--lg',
};

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
] as const;
