import { type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow } from '../inkstone-ui.js';
import {
  endpointLabel,
  hostConnectionSubtitle,
} from '../pages/sessions.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';

export function HostSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  const { host, onOpenConnection } = hostCtx;
  const ready = host.connectionState.kind === 'ready';
  return (
    <>
      <ListRow
        name="panel"
        title={endpointLabel(host.endpoint)}
        subtitle={hostConnectionSubtitle(host)}
        onClick={() =>
          dispatch({ type: 'toast', message: ready ? '已连接这台 Host' : '正在连接…' })
        }
        trailing={ready ? '✓' : '重连'}
        selected={ready}
      />
      <ListRow
        name="plus"
        title="管理连接"
        subtitle="地址 · 配对 · 凭据"
        onClick={onOpenConnection}
      />
      <FullButton variant="secondary" onClick={() => void host.handleDisconnect()}>
        断开连接
      </FullButton>
    </>
  );
}

