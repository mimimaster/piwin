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
});
