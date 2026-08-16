import type { ReactElement } from 'react';
import type { DoccardsProgressView } from './doccards-progress';

export type DocCardsProgressRingProps = {
  progress: DoccardsProgressView;
  locale: 'en' | 'zh-CN';
};

const SIZE = 56;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DocCardsProgressRing(props: DocCardsProgressRingProps): ReactElement {
  const offset = CIRCUMFERENCE - (Math.min(100, Math.max(0, props.progress.percent)) / 100) * CIRCUMFERENCE;
  const label = props.locale === 'zh-CN' ? props.progress.labelZh : props.progress.labelEn;
  return (
    <div className="doc-cards-progress" data-testid="doc-cards-progress" role="status" aria-label={label}>
      <svg
        className="doc-cards-progress-ring"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
      >
        <circle
          className="doc-cards-progress-track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
        />
        <circle
          className="doc-cards-progress-fill"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle">
          {props.progress.percent}%
        </text>
      </svg>
      <span className="doc-cards-progress-label">{label}</span>
    </div>
  );
}
