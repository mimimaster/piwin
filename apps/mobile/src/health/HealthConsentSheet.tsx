import type { ReactElement } from 'react';
import type { ClientToolRequestFrame } from '@piwin/contracts';
import type { MobileClientToolConsentDecision } from '../client-tools/mobile-client-tool-runtime.js';

export type HealthConsentSheetProps = {
  request: ClientToolRequestFrame;
  hostLabel: string;
  onDecide: (decision: MobileClientToolConsentDecision) => void;
  alwaysAllowUnlocked?: boolean;
};

export function HealthConsentSheet({
  request,
  hostLabel,
  onDecide,
  alwaysAllowUnlocked = false,
}: HealthConsentSheetProps): ReactElement {
  const destination =
    request.display.provider === undefined
      ? hostLabel
      : `${hostLabel} · ${request.display.provider.label}（${request.display.provider.processing === 'local' ? '本地' : '外部'}）`;

  return (
    <div
      className="health-consent-sheet"
      role="dialog"
      aria-labelledby="health-consent-title"
      data-testid="health-consent-sheet"
    >
      <h2 id="health-consent-title">Piwin 想为这个问题读取 Apple Health</h2>
      <p>{request.display.metricLabels.join('、')}</p>
      <p>{request.display.periodLabel}</p>
      <p>目标：{destination}</p>
      <p>Piwin 只读，不会向 Apple Health 写入任何内容。</p>
      <div className="health-consent-actions">
        <button type="button" onClick={() => onDecide('once')}>
          允许一次
        </button>
        <button type="button" onClick={() => onDecide('session')}>
          允许本次会话
        </button>
        {alwaysAllowUnlocked ? (
          <button type="button" onClick={() => onDecide('always')}>
            始终允许此 Host
          </button>
        ) : null}
        <button type="button" onClick={() => onDecide('deny')}>
          拒绝
        </button>
      </div>
    </div>
  );
}
