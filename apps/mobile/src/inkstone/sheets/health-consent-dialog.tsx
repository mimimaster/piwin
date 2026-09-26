import { useEffect, useRef, type ReactElement } from 'react';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { Icon } from '../icons.js';
import { FullButton } from '../inkstone-ui.js';
import { endpointLabel } from '../pages/sessions.js';

/**
 * Host-initiated Apple Health read request. The client-tool runtime awaits
 * this decision, so it must be reachable from any page — a sheet key would
 * lose it the moment another sheet opens. Dismissing counts as "deny" so the
 * model's tool call never hangs.
 */
export function HealthConsentDialog(): ReactElement | null {
  const hostCtx = useInkstoneHost();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const request = hostCtx?.host.healthConsentRequest;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (request !== undefined && !dialog.open) {
      dialog.showModal();
    } else if (request === undefined && dialog.open) {
      dialog.close();
    }
  }, [request]);

  if (hostCtx === null) return null;
  const { host } = hostCtx;
  const hostLabel = endpointLabel(host.endpoint);
  const provider = request?.display.provider;
  const destination =
    provider === undefined
      ? hostLabel
      : `${hostLabel} · ${provider.label}（${provider.processing === 'local' ? '本地处理' : '外部模型'}）`;

  return (
    <dialog
      className="inkstone-sheet health-consent"
      ref={dialogRef}
      aria-label="读取 Apple Health"
      onCancel={(event) => {
        event.preventDefault();
        host.resolveHealthConsent('deny');
      }}
    >
      {request !== undefined ? (
        <>
          <div className="sheet-grab" />
          <div className="sheet-head">
            <h2>
              <Icon name="drop" /> 读取 Apple Health
            </h2>
          </div>
          <div className="sheet-body">
            <p>模型想为这个问题读取以下健康摘要：</p>
            <dl className="facts">
              <dt>数据</dt>
              <dd>{request.display.metricLabels.join('、')}</dd>
              <dt>时间</dt>
              <dd>{request.display.periodLabel}</dd>
              <dt>发送到</dt>
              <dd>{destination}</dd>
            </dl>
            <p className="quote-note">只读摘要，不会写入 Apple Health；原始样本不离开手机。</p>
            <FullButton onClick={() => host.resolveHealthConsent('once')}>允许一次</FullButton>
            <FullButton variant="secondary" onClick={() => host.resolveHealthConsent('session')}>
              本次会话都允许
            </FullButton>
            {host.healthAlwaysAllowUnlocked ? (
              <FullButton variant="secondary" onClick={() => host.resolveHealthConsent('always')}>
                始终允许这台 Host
              </FullButton>
            ) : null}
            <FullButton variant="subtle" onClick={() => host.resolveHealthConsent('deny')}>
              拒绝
            </FullButton>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
