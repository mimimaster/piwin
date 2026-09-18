import type { ReactElement } from 'react';

export type ProviderTestStatus = {
  tone: 'ok' | 'err' | 'warn' | 'off';
  message: string;
  durationMs?: number;
};

export function ProviderStatusPill({
  status,
}: {
  status: ProviderTestStatus | null;
}): ReactElement | null {
  if (!status) return null;

  return (
    <span
      className={`provider-status-pill provider-status-pill--${status.tone}`}
      title={status.message}
    >
      <span className="provider-status-pill-dot" />
      <span className="provider-status-pill-text">{status.message}</span>
    </span>
  );
}
