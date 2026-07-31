/**
 * Host IPC handlers: browser session (ADR 0020 §3, §5).
 *
 * Panel-initiated commands are USER-initiated — no permission prompt — but all
 * handlers acquire the session mutex (`runExclusive`) so agent tool calls and
 * user picks never interleave against a mid-navigation page. Frame/state
 * events from the session are forwarded to `context.push` so the desktop panel
 * mirrors the agent's Chromium instance.
 */
import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'browser/start',
  'browser/navigate',
  'browser/pick-at',
  'browser/screenshot',
  'browser/stop',
]);

export function isBrowserCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleBrowserCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }

  const session = context.getBrowserSession?.();
  if (!session) {
    return fail(
      requestId,
      command.type,
      'browser session is not available (host did not start one)',
    );
  }

  switch (command.type) {
    case 'browser/start': {
      // Ensure the session is reachable; currentState triggers lazy launch on
      // first real use. The session object already exists, so just return state.
      const state = await session.runExclusive(async () => session.currentState());
      return ok(requestId, 'browser/start', { state });
    }

    case 'browser/navigate': {
      // Panel-initiated navigation is user intent — no permission prompt.
      // Still serialized through the mutex so an in-flight agent tool call
      // does not race with the user's URL bar.
      await session.navigate(command.url);
      const state = session.currentState();
      return ok(requestId, 'browser/navigate', { state });
    }

    case 'browser/pick-at': {
      const result = await session.pickElementAt(command.x, command.y);
      // User-initiated pick → push the result so the composer chip appears.
      context.push({ type: 'browser/picked', result });
      return ok(requestId, 'browser/pick-at', { result });
    }

    case 'browser/screenshot': {
      const screenshot = await session.screenshot(command.path);
      return ok(requestId, 'browser/screenshot', {
        width: screenshot.width,
        height: screenshot.height,
        ...(screenshot.path !== undefined ? { path: screenshot.path } : {}),
      });
    }

    case 'browser/stop': {
      await session.close();
      return ok(requestId, 'browser/stop', { stopped: true });
    }

    default:
      return null;
  }
}

/**
 * Wire a browser session's frame/state event stream to `context.push`.
 * Returns an unsubscribe function; call it when the session is replaced or
 * the host shuts down.
 */
export function wireBrowserSessionPushes(
  session: BrowserSession,
  push: (message: HostPush) => void,
): () => void {
  return session.subscribe((event) => {
    push(event);
  });
}
