import { describe, expect, it, vi } from 'vitest';
import {
  bindExtensionUiToPiSession,
  createExtensionUiContext,
  type ExtensionUiResponse,
} from './extension-ui-bridge.js';

describe('extension-ui-bridge', () => {
  it('confirm resolves through bridge', async () => {
    const request = vi.fn(async (): Promise<ExtensionUiResponse> => ({
      kind: 'confirm',
      confirmed: true,
    }));
    const ui = createExtensionUiContext(
      'sess-1',
      { request },
      () => 'req-1',
    );
    const confirm = ui.confirm as (
      title: string,
      message: string,
    ) => Promise<boolean>;
    await expect(confirm('Title', 'Message')).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        kind: 'confirm',
        title: 'Title',
        message: 'Message',
      }),
    );
  });

  it('select returns chosen value', async () => {
    const ui = createExtensionUiContext(
      'sess-1',
      {
        request: async () => ({ kind: 'select', value: 'b' }),
      },
      () => 'req-2',
    );
    const select = ui.select as (
      title: string,
      options: string[],
    ) => Promise<string | undefined>;
    await expect(select('Pick', ['a', 'b'])).resolves.toBe('b');
  });

  it('bindExtensionUiToPiSession calls bindExtensions when present', async () => {
    const bindExtensions = vi.fn(async () => undefined);
    const ok = await bindExtensionUiToPiSession(
      { bindExtensions },
      { confirm: async () => false },
    );
    expect(ok).toBe(true);
    expect(bindExtensions).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'rpc' }),
    );
  });

  it('bindExtensionUiToPiSession returns false without bindExtensions', async () => {
    await expect(bindExtensionUiToPiSession({}, {})).resolves.toBe(false);
  });

  it('publishes notices, statuses, text widgets and working messages without terminal escapes', () => {
    const publish = vi.fn();
    const ui = createExtensionUiContext(
      'sess-1',
      { request: async () => ({ kind: 'confirm', confirmed: false }), publish },
      () => 'req-surface',
    ) as Record<string, (...args: unknown[]) => unknown>;
    const theme = ui.theme as unknown as Record<string, (...args: unknown[]) => string>;

    ui.notify?.('saved', 'warning');
    ui.setStatus?.('git', theme.fg?.('accent', '\u001b[32mmain\u001b[0m'));
    ui.setStatus?.('git', undefined);
    ui.setWidget?.('todo', ['- [ ] one', '\u001b[1m- [x] two\u001b[22m'], { placement: 'belowEditor' });
    ui.setWidget?.('tui-only', () => ({ render: () => [] }));
    ui.setWidget?.('todo', undefined);
    ui.setWorkingMessage?.('indexing…');

    expect(publish.mock.calls.map(([update]) => update)).toEqual([
      { kind: 'notify', message: 'saved', level: 'warning' },
      { kind: 'status', key: 'git', text: 'main' },
      { kind: 'status', key: 'git' },
      { kind: 'widget', key: 'todo', placement: 'belowEditor', lines: ['- [ ] one', '- [x] two'] },
      { kind: 'widget', key: 'todo', placement: 'aboveEditor' },
      { kind: 'working-message', message: 'indexing…' },
    ]);
  });

  it('keeps the extension running when publishing throws', () => {
    const ui = createExtensionUiContext(
      'sess-1',
      {
        request: async () => ({ kind: 'confirm', confirmed: false }),
        publish: () => {
          throw new Error('transport closed');
        },
      },
      () => 'req-throw',
    ) as Record<string, (...args: unknown[]) => unknown>;
    expect(() => ui.setStatus?.('k', 'v')).not.toThrow();
  });
});

