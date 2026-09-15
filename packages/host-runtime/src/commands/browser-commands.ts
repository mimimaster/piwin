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
import { toMediaAttachmentRef } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { createMediaService } from '@piwin/media';
import { mapBrowserToolError, sanitizeBrowserErrorMessage } from '../browser-tool-errors.js';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'browser/start',
  'browser/navigate',
  'browser/pick-at',
  'browser/screenshot',
  'browser/capture',
  'browser/stop',
  'browser/restart',
  'browser/reload',
  'browser/input',
  'browser/lock',
  'browser/unlock',
  'browser/resize',
  'browser/back',
  'browser/forward',
  'browser/new-tab',
  'browser/select-tab',
  'browser/close-tab',
  'browser/dialog',
]);

function failFromBrowserError(
  requestId: string | undefined,
  command: string,
  error: unknown,
): HostResponse {
  const mapped = mapBrowserToolError(error);
  if (mapped) {
    return fail(requestId, command, mapped.message, {
      code: mapped.code,
      ...(mapped.retryable !== undefined ? { retryable: mapped.retryable } : {}),
      ...(mapped.details !== undefined ? { data: mapped.details } : {}),
    });
  }
  return fail(requestId, command, sanitizeBrowserErrorMessage(error));
}

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

  const session =
    context.getBrowserSession?.() ?? (await context.ensureBrowserSession?.());
  if (!session) {
    return fail(
      requestId,
      command.type,
      'browser session is not available (host did not start one)',
    );
  }

  switch (command.type) {
    case 'browser/start': {
      // Opening the panel acquires the mirror lease: launch Chromium if needed
      // and begin the bounded frame stream.
      try {
        const state = await session.start(command.leaseId);
        return ok(requestId, 'browser/start', { state });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/navigate': {
      try {
        await session.navigate(command.url, { actor: 'user' });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
      const state = session.currentState();
      return ok(requestId, 'browser/navigate', { state });
    }

    case 'browser/pick-at': {
      try {
        const result = await session.pickElementAt(command.x, command.y, {
          ...(command.target === undefined ? {} : { target: command.target }),
        });
        context.push({ type: 'browser/picked', result });
        return ok(requestId, 'browser/pick-at', { result });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/screenshot': {
      try {
        const screenshot = await session.screenshot(command.path);
        return ok(requestId, 'browser/screenshot', {
          width: screenshot.width,
          height: screenshot.height,
          ...(screenshot.path !== undefined ? { path: screenshot.path } : {}),
        });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/capture': {
      try {
        const captured = await session.capture({
          ...(command.quality === undefined ? {} : { quality: command.quality }),
          ...(command.fullPage === true ? { fullPage: true } : {}),
        });
        const sessionId = command.sessionId ?? 'browser-workbench';
        const media = createMediaService({
          mediaRoot: getPiwinMediaDir(getPiwinRoot(context.piwinRoot)),
          maxPasteBytes: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
        const asset = await media.saveMediaAsset({
          sessionId,
          bytes: captured.bytes,
          mimeType: captured.mime,
          name: 'browser-capture.jpg',
          source: 'generated',
        });
        const attachment = toMediaAttachmentRef(
          { ...asset, width: captured.width, height: captured.height },
          'generated',
        );
        return ok(requestId, 'browser/capture', {
          attachment,
          target: session.currentTarget(),
          width: captured.width,
          height: captured.height,
        });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/stop': {
      try {
        await session.stop(command.leaseId);
        return ok(requestId, 'browser/stop', { stopped: true });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/restart': {
      // Panel-initiated: same user actor as navigate. Does not mint a new lease.
      try {
        const result = await session.restart({ actor: 'user' });
        return ok(requestId, 'browser/restart', result);
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/reload': {
      try {
        await session.reload({ actor: 'user' });
        return ok(requestId, 'browser/reload', { ok: true });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/input': {
      try {
        await session.dispatchInput(command.events, {
          ...(command.target === undefined ? {} : { target: command.target }),
        });
        return ok(requestId, 'browser/input', { count: command.events.length });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/lock': {
      try {
        const state =
          command.owner === 'user' ? await session.takeOver() : await session.lock('agent');
        return ok(requestId, 'browser/lock', { state });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/unlock': {
      try {
        const state =
          command.owner === 'user' ? await session.giveBack() : await session.unlock('agent');
        return ok(requestId, 'browser/unlock', { state });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/resize': {
      try {
        const origin = command.origin ?? 'explicit';
        if (origin === 'follow') {
          const owner = session.controllerState().owner;
          if (owner === 'agent') {
            return fail(requestId, command.type, 'follow resize is paused while the agent has control', {
              code: 'browser-agent-has-control',
              retryable: false,
            });
          }
          if (session.mirrorLeaseCount() !== 1) {
            return fail(
              requestId,
              command.type,
              'follow resize is frozen while multiple clients mirror the browser',
              { code: 'browser-action-failed', retryable: false },
            );
          }
          if (command.leaseId !== undefined && !session.hasMirrorLease(command.leaseId)) {
            return fail(requestId, command.type, 'follow resize lease is not active', {
              code: 'browser-action-failed',
              retryable: false,
            });
          }
        }
        const size = { width: command.width, height: command.height };
        const mode = command.mode ?? (origin === 'follow' ? 'follow' : undefined);
        const viewport = await session.setViewport(size, {
          ...(mode !== undefined ? { mode } : {}),
          setBy: 'user',
        });
        return ok(requestId, 'browser/resize', { viewport });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/back': {
      try {
        await session.back({ actor: 'user' });
        return ok(requestId, 'browser/back', { ok: true });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/forward': {
      try {
        await session.forward({ actor: 'user' });
        return ok(requestId, 'browser/forward', { ok: true });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/new-tab': {
      try {
        const tab = await session.newTab(command.url, { actor: 'user' });
        return ok(requestId, 'browser/new-tab', { tab });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/select-tab': {
      try {
        const tab = await session.selectTab(command.pageId, { actor: 'user' });
        return ok(requestId, 'browser/select-tab', { tab });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/close-tab': {
      try {
        await session.closeTab(command.pageId, { actor: 'user' });
        return ok(requestId, 'browser/close-tab', { ok: true });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
    }

    case 'browser/dialog': {
      try {
        const dialog = await session.handleDialog(command.action, command.promptText, {
          actor: 'user',
        });
        return ok(requestId, 'browser/dialog', { dialog });
      } catch (error) {
        return failFromBrowserError(requestId, command.type, error);
      }
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
