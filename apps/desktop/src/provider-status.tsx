import type { ReactElement } from 'react';

export type ProviderTestStatus = {
  tone: 'ok' | 'err' | 'warn' | 'off';
  message: string;
  durationMs?: number;
};

export function ProviderStatusPill({ status }: { status: ProviderTestStatus }): ReactElement {
  return (
    <span className={`provider-status-pill provider-status-pill--${status.tone}`}>
      <span className="provider-status-pill-dot" />
      <span className="provider-status-pill-text">{status.message}</span>
    </span>
  );
}
