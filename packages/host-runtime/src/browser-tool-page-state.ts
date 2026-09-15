import type { BrowserSession } from '@piwin/browser';
import type { BrowserLifecycle } from '@piwin/contracts';

export type BrowserPageState = {
  url: string;
  title?: string;
  pageId?: string;
};

export type BrowserNextAction =
  | 'wait-for-ready'
  | 'snapshot-and-retarget'
  | 'wait-for-user-handoff'
  | 'continue';

export function readBrowserPageState(session: BrowserSession): BrowserPageState | undefined {
  const state = session.currentState();
  const status = session.status();
  const url = state.url ?? status.url;
  if (typeof url !== 'string' || url.length === 0) return undefined;
  const title = state.title ?? status.title;
  const pageId = status.pageId;
  return {
    url,
    ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
    ...(typeof pageId === 'string' && pageId.length > 0 ? { pageId } : {}),
  };
}

export function nextBrowserAction(input: {
  lifecycle: BrowserLifecycle;
  controller: 'idle' | 'agent' | 'user';
  pageStateLost: boolean;
}): BrowserNextAction {
  if (input.lifecycle === 'starting' || input.lifecycle === 'recovering') return 'wait-for-ready';
  if (input.pageStateLost || input.lifecycle === 'failed') return 'snapshot-and-retarget';
  if (input.controller === 'user') return 'wait-for-user-handoff';
  return 'continue';
}
