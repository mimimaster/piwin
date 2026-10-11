import { TuiAltScreen } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TuiApp } from './tui-app.js';
import type { TuiHostLink } from './tui-host-link.js';
import { TuiTestTerminal } from './tui-terminal.fixture.js';

vi.mock('./clipboard-image.js', () => ({
  readClipboardImage: async () => ({
    kind: 'image',
    image: { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png' },
  }),
}));

function gate() {
  let release = () => undefined as void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}

function fixture(held: Map<HostCommand['type'], Promise<void>>) {
  const terminal = new TuiTestTerminal();
  const tui = new TuiAltScreen(terminal);
  const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    await held.get(command.type);
    const data =
      command.type === 'session/resume'
        ? {
            sessionId: 'existing',
            scope: 'general',
            name: 'existing session',
            lastRequestUsage: null,
            messages: [
              {
                id: 'u1',
                role: 'user',
                text: 'Restored conversation',
                createdAt: '',
                status: 'done',
              },
            ],
          }
        : command.type === 'session/list'
          ? { sessions: [{ sessionId: 'existing' }] }
          : {
              projects: [],
              models: [],
              config: {},
              permissions: [],
              plan: null,
              queuedTurns: [],
              branchPoints: [],
              sessions: [],
              items: [],
              run: null,
            };
    return { type: 'response', command: command.type, success: true, data };
  });
  // These tests isolate startup scheduling; transport integration uses the real-Host harness.
  const link = {
    request,
    client: {
      updateSubscriptions: vi.fn(async () => undefined),
      subscribePush: () => () => undefined,
      subscribeState: () => () => undefined,
    },
  } as unknown as TuiHostLink;
  const app = new TuiApp({
    tui,
    link,
    sessionId: 'existing',
    embedded: true,
    mock: true,
    onExit: vi.fn(),
  });
  return {
    terminal,
    app,
    request,
    dispose: () => {
      app.dispose();
      tui.stop();
    },
  };
}

describe('TUI startup scheduling', () => {
  it('restores and draws history while projects, models and session features are delayed', async () => {
    const auxiliary = gate();
    const index = gate();
    const held = new Map<HostCommand['type'], Promise<void>>([
      ['project/list', auxiliary.pending],
      ['models/configured', auxiliary.pending],
      ['plan/get', auxiliary.pending],
      ['session/list', index.pending],
    ]);
    const test = fixture(held);
    const started = test.app.start();
    try {
      await vi.waitFor(() => expect(test.terminal.text()).toContain('Restored conversation'));
      index.release();
      await vi.waitFor(() =>
        expect(
          test.request.mock.calls.some(([command]) => command.type === 'session/foreground-run'),
        ).toBe(true),
      );
      await vi.waitFor(() => expect(test.terminal.output).toContain(';piwin;session;existing'));
    } finally {
      index.release();
      auxiliary.release();
      await started;
      test.dispose();
    }
  });

  it('keeps early input in the composer and never creates a different session during resume', async () => {
    const resume = gate();
    const test = fixture(new Map([['session/resume', resume.pending]]));
    const started = test.app.start();
    try {
      test.terminal.type('my draft');
      test.terminal.type('\r');
      await vi.waitFor(() => expect(test.terminal.text()).toContain('my draft'));
      expect(
        test.request.mock.calls.some(
          ([command]) => command.type === 'session/create' || command.type === 'session/prompt',
        ),
      ).toBe(false);
      resume.release();
      await started;
      expect([...test.terminal.screen.values()].join('\n')).toContain('my draft');
    } finally {
      resume.release();
      await started;
      test.dispose();
    }
  });
  it('never creates a draft media vault when an image is pasted during resume', async () => {
    const resume = gate();
    const test = fixture(new Map([['session/resume', resume.pending]]));
    const started = test.app.start();
    try {
      test.terminal.type('draft');
      test.terminal.type('\x16');
      await vi.waitFor(() => expect(test.terminal.text()).toContain('请稍候再操作'));
      expect(
        test.request.mock.calls.some(
          ([command]) => command.type === 'session/create' || command.type === 'media/save-begin',
        ),
      ).toBe(false);
    } finally {
      resume.release();
      await started;
      test.dispose();
    }
  });
  it('keeps the resumed conversation usable when an auxiliary catalog read fails', async () => {
    const test = fixture(new Map());
    const original = test.request.getMockImplementation();
    if (original === undefined) throw new Error('fixture request missing');
    test.request.mockImplementation((command) =>
      command.type === 'models/configured'
        ? Promise.resolve({
            type: 'response',
            command: command.type,
            success: false,
            error: 'catalog unavailable',
          })
        : original(command),
    );
    try {
      await expect(test.app.start()).resolves.toBeUndefined();
      await vi.waitFor(() => expect(test.terminal.text()).toContain('catalog unavailable'));
      expect(test.app.currentSessionId()).toBe('existing');
      expect(test.terminal.text()).toContain('Restored conversation');
    } finally {
      test.dispose();
    }
  });
});
