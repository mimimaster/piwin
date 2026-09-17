/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopAttentionOs } from './desktop-attention-os.js';
import { createNoopDesktopAttentionOs } from './desktop-attention-os-noop.js';
import { createTauriDesktopAttentionOs } from './desktop-attention-os-tauri.js';

const {
  invokeMock,
  listenMock,
  setBadgeCountMock,
  setBadgeLabelMock,
  requestUserAttentionMock,
  getCurrentWindowMock,
} = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  setBadgeCountMock: vi.fn(),
  setBadgeLabelMock: vi.fn(),
  requestUserAttentionMock: vi.fn(),
  getCurrentWindowMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: getCurrentWindowMock,
  UserAttentionType: { Critical: 1, Informational: 2 },
}));

const DELIVER_INPUT = {
  identifier: 'piwin.attention.session-1',
  threadId: 'project-1',
  title: 'Turn complete',
  body: 'Research',
  sessionId: 'session-1',
  attentionKey: 'complete:run-1',
  sound: true,
};

function enableTauriRuntime(): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: {},
  });
}

describe('createDesktopAttentionOs', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    invokeMock.mockReset();
  });

  it('returns the noop adapter outside Tauri', async () => {
    const os = createDesktopAttentionOs();
    await expect(os.getAuthorization()).resolves.toBe('unsupported');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('returns the Tauri adapter when the runtime is present', async () => {
    enableTauriRuntime();
    invokeMock.mockResolvedValue({
      nativeCenter: true,
      clickActivation: true,
      authorizationReliable: true,
    });
    const os = createDesktopAttentionOs();
    await expect(os.getCapabilities()).resolves.toEqual({
      nativeCenter: true,
      clickActivation: true,
      authorizationReliable: true,
    });
    expect(invokeMock).toHaveBeenCalledWith('attention_capabilities');
  });
});

describe('AN-T44 noop DesktopAttentionOs', () => {
  it('returns unsupported capabilities and never throws', async () => {
    const os = createNoopDesktopAttentionOs();
    const unsub = os.subscribeActivation(() => {
      throw new Error('noop must not deliver activations');
    });

    await expect(os.getCapabilities()).resolves.toEqual({
      nativeCenter: false,
      clickActivation: false,
      authorizationReliable: false,
    });
    await expect(os.getAuthorization()).resolves.toBe('unsupported');
    await expect(os.requestAuthorization()).resolves.toBe('unsupported');
    await expect(os.deliver(DELIVER_INPUT)).resolves.toBe('unsupported');
    await expect(os.removeDelivered(['piwin.attention.session-1'])).resolves.toBeUndefined();
    await expect(os.setBadge({ kind: 'count', value: 3 })).resolves.toBeUndefined();
    await expect(os.setBadge({ kind: 'label', value: '99+' })).resolves.toBeUndefined();
    await expect(os.setBadge({ kind: 'clear' })).resolves.toBeUndefined();
    await expect(os.requestAttention()).resolves.toBeUndefined();
    await expect(os.takePendingActivation()).resolves.toBeNull();
    await expect(os.openSystemSettings()).resolves.toBeUndefined();
    expect(() => unsub()).not.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('AN-T43 Tauri DesktopAttentionOs', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    setBadgeCountMock.mockReset();
    setBadgeLabelMock.mockReset();
    requestUserAttentionMock.mockReset();
    getCurrentWindowMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    listenMock.mockResolvedValue(vi.fn());
    setBadgeCountMock.mockResolvedValue(undefined);
    setBadgeLabelMock.mockResolvedValue(undefined);
    requestUserAttentionMock.mockResolvedValue(undefined);
    getCurrentWindowMock.mockReturnValue({
      setBadgeCount: setBadgeCountMock,
      setBadgeLabel: setBadgeLabelMock,
      requestUserAttention: requestUserAttentionMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes AN-I08 commands with camelCase argument shapes', async () => {
    const os = createTauriDesktopAttentionOs();
    invokeMock.mockResolvedValueOnce({
      nativeCenter: true,
      clickActivation: true,
      authorizationReliable: true,
    });
    invokeMock.mockResolvedValueOnce('not-determined');
    invokeMock.mockResolvedValueOnce('granted');
    invokeMock.mockResolvedValueOnce('delivered');
    invokeMock.mockResolvedValueOnce(undefined);
    invokeMock.mockResolvedValueOnce(null);
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(os.getCapabilities()).resolves.toEqual({
      nativeCenter: true,
      clickActivation: true,
      authorizationReliable: true,
    });
    await expect(os.getAuthorization()).resolves.toBe('not-determined');
    await expect(os.requestAuthorization()).resolves.toBe('granted');
    await expect(os.deliver(DELIVER_INPUT)).resolves.toBe('delivered');
    await os.removeDelivered(['piwin.attention.session-1', 'piwin.attention.summary']);
    await expect(os.takePendingActivation()).resolves.toBeNull();
    await os.openSystemSettings();

    expect(invokeMock.mock.calls).toEqual([
      ['attention_capabilities'],
      ['attention_authorization_status'],
      ['attention_request_authorization'],
      ['attention_deliver', { input: DELIVER_INPUT }],
      [
        'attention_remove_delivered',
        { identifiers: ['piwin.attention.session-1', 'piwin.attention.summary'] },
      ],
      ['attention_take_pending_activation'],
      ['attention_open_system_settings'],
    ]);
  });

  it('maps dock badge and bounce onto the current window APIs', async () => {
    const os = createTauriDesktopAttentionOs();
    await os.setBadge({ kind: 'clear' });
    await os.setBadge({ kind: 'count', value: 4 });
    await os.setBadge({ kind: 'label', value: '99+' });
    await os.requestAttention();

    expect(setBadgeCountMock.mock.calls).toEqual([[], [4]]);
    expect(setBadgeLabelMock.mock.calls).toEqual([[], ['99+']]);
    expect(requestUserAttentionMock).toHaveBeenCalledWith(2);
  });

  it('forwards a valid pending activation from the take command', async () => {
    const os = createTauriDesktopAttentionOs();
    invokeMock.mockResolvedValue({
      sessionId: 'session:1_ok',
      attentionKey: 'permission:tool-1',
    });
    await expect(os.takePendingActivation()).resolves.toEqual({
      sessionId: 'session:1_ok',
      attentionKey: 'permission:tool-1',
    });
    expect(invokeMock).toHaveBeenCalledWith('attention_take_pending_activation');
  });

  it('drops illegal activation payloads from events and takePendingActivation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const os = createTauriDesktopAttentionOs();
    const listener = vi.fn();
    let onActivate: ((event: { payload: unknown }) => void) | undefined;
    listenMock.mockImplementation(async (_event: string, handler: (event: { payload: unknown }) => void) => {
      onActivate = handler;
      return vi.fn();
    });

    const unsubscribe = os.subscribeActivation(listener);
    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledWith('attention://activate', expect.any(Function));
    });

    const tooLong = 'a'.repeat(129);
    onActivate?.({ payload: { sessionId: 'session 1', attentionKey: 'complete:run-1' } });
    onActivate?.({ payload: { sessionId: 'session-1', attentionKey: tooLong } });
    onActivate?.({ payload: { sessionId: '', attentionKey: 'k' } });
    onActivate?.({ payload: { sessionId: 1, attentionKey: 'k' } });
    onActivate?.({ payload: null });
    onActivate?.({
      payload: { sessionId: 'session-1', attentionKey: 'complete:run-1' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      sessionId: 'session-1',
      attentionKey: 'complete:run-1',
    });
    expect(warn).toHaveBeenCalled();

    invokeMock.mockResolvedValue({ sessionId: 'no spaces allowed', attentionKey: 'k' });
    await expect(os.takePendingActivation()).resolves.toBeNull();

    unsubscribe();
  });

  it('unsubscribes the activation listener', async () => {
    const os = createTauriDesktopAttentionOs();
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    const unsubscribe = os.subscribeActivation(vi.fn());
    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalled();
    });
    unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
