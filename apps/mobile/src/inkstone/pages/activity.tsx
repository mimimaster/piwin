import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { InboxPage } from './inbox.js';

export function ActivityPage(): ReactElement {
  const hostCtx = useInkstoneHost();

  // A Host context is authoritative even while connecting or recovering; do
  // not replace a live shell with fabricated activity while the socket is down.
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <InboxPage />;
}
