import type { BrowserSession } from '@piwin/browser';
import type { BrowserLifecycle, BrowserToolNextAction, BrowserToolPageState } from '@piwin/contracts';

/**
 * Lightweight page identity for browser tool successes (spec §6.3). Deliberately
 * small: the model decides whether to follow up with snapshot/screenshot.
 */
export function readBrowserPageState(session: BrowserSession): BrowserToolPageState | undefined {
  const state = session.currentState();
  const status = session.status();
  const url = state.url ?? status.url;
  if (typeof url !== 'string' || url.length === 0) return undefined;
  const title = state.title ?? status.title;
  return {
    url,
    ...(typeof title === 'string' && title.length > 0 ? { title } : {}),
    generation: status.generation,
    ...(typeof status.pageId === 'string' && status.pageId.length > 0
      ? { pageId: status.pageId }
      : {}),
    pendingDialog: session.pendingDialog() !== undefined,
  };
}

/**
 * Stable next step for the model (spec §5.2). Derived only from lifecycle —
 * the user sharing the page never blocks the agent, and never from frame timing, so an idle static page does not
 * look broken.
 */
export function nextBrowserAction(input: {
  lifecycle: BrowserLifecycle;
  controller: 'idle' | 'agent' | 'user';
}): BrowserToolNextAction {
  if (input.lifecycle === 'recovering') return 'wait-for-recovery';
  if (input.lifecycle === 'failed' || input.lifecycle === 'disposed') return 'restart';
  if (input.lifecycle === 'stopped' || input.lifecycle === 'starting') {
    return 'navigate-or-observe-will-start';
  }
  return 'continue';
}
