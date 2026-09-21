// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_ATTENTION_PREFERENCES } from '@piwin/host-client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_LIGHT } from '../../appearance-tokens';
import {
  ATTENTION_PREFERENCES_KEY,
  readAttentionPreferences,
  writeAttentionPreferences,
} from '../../attention-preferences';
import type {
  AttentionAuthorization,
  AttentionOsCapabilities,
  DesktopAttentionOs,
} from '../../desktop-attention-os';
import { DesktopLocaleProvider } from '../../desktop-locale-context';
import { NotificationsPage } from './notifications-page';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function createFakeOs(
  authorization: AttentionAuthorization,
  capabilities: Partial<AttentionOsCapabilities> = {},
): DesktopAttentionOs & {
  requestAuthorization: ReturnType<typeof vi.fn>;
  openSystemSettings: ReturnType<typeof vi.fn>;
} {
  return {
    getCapabilities: vi.fn(async () => ({
      nativeCenter: true,
      clickActivation: true,
      authorizationReliable: true,
      ...capabilities,
    })),
    getAuthorization: vi.fn(async () => authorization),
    requestAuthorization: vi.fn(async () => 'granted' as const),
    deliver: vi.fn(async () => 'delivered' as const),
    removeDelivered: vi.fn(async () => undefined),
    setBadge: vi.fn(async () => undefined),
    requestAttention: vi.fn(async () => undefined),
    takePendingActivation: vi.fn(async () => null),
    subscribeActivation: vi.fn(() => () => undefined),
    openSystemSettings: vi.fn(async () => undefined),
  };
}

describe('NotificationsPage', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let storage: MemoryStorage;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    storage = new MemoryStorage();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    host?.remove();
    host = null;
    root = null;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  async function renderPage(
    os: DesktopAttentionOs,
    locale: 'zh-CN' | 'en' = 'zh-CN',
  ): Promise<void> {
    await act(async () => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_LIGHT}>
          <DesktopLocaleProvider locale={locale} onLocaleChange={() => undefined}>
            <NotificationsPage os={os} storage={storage} />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  describe('AN-T46 authorization row', () => {
    it('renders granted copy without system-settings or enable actions', async () => {
      await renderPage(createFakeOs('granted'));
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')?.textContent).toBe(
        '已开启',
      );
      expect(host?.querySelector('[data-testid="attention-open-system-settings"]')).toBeNull();
      expect(host?.querySelector('[data-testid="attention-enable-authorization"]')).toBeNull();
    });

    it('renders denied copy and opens system settings', async () => {
      const os = createFakeOs('denied');
      await renderPage(os);
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')?.textContent).toBe(
        '已关闭',
      );
      await act(async () => {
        host?.querySelector<HTMLButtonElement>('[data-testid="attention-open-system-settings"]')?.click();
      });
      expect(os.openSystemSettings).toHaveBeenCalledTimes(1);
    });

    it('renders not-determined enable control and requests authorization', async () => {
      const os = createFakeOs('not-determined');
      await renderPage(os);
      expect(host?.querySelector('[data-testid="attention-enable-authorization"]')).toBeTruthy();
      await act(async () => {
        host?.querySelector<HTMLButtonElement>('[data-testid="attention-enable-authorization"]')?.click();
        await Promise.resolve();
      });
      expect(os.requestAuthorization).toHaveBeenCalledTimes(1);
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')?.textContent).toBe(
        '已开启',
      );
    });

    it('renders unsupported copy', async () => {
      await renderPage(createFakeOs('unsupported'));
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')?.textContent).toBe(
        '当前运行方式不支持系统通知',
      );
      expect(host?.querySelector('[data-testid="attention-open-system-settings"]')).toBeNull();
      expect(host?.querySelector('[data-testid="attention-enable-authorization"]')).toBeNull();
    });

    it('does not expose macOS settings controls when the native center is unavailable', async () => {
      await renderPage(
        createFakeOs('unsupported', {
          nativeCenter: false,
          clickActivation: false,
          authorizationReliable: false,
        }),
      );
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')?.textContent).toBe(
        '当前运行方式不支持系统通知',
      );
      expect(host?.querySelector('[data-testid="attention-open-system-settings"]')).toBeNull();
      expect(host?.querySelector('[data-testid="attention-authorization-row"]')?.textContent).not.toContain(
        'macOS',
      );
    });

    it('renders open-system-settings and managed copy in description when authorization is unreliable', async () => {
      const os = createFakeOs('granted', { authorizationReliable: false });
      await renderPage(os);
      expect(host?.querySelector('[data-testid="attention-open-system-settings"]')).toBeTruthy();
      expect(host?.querySelector('[data-testid="attention-authorization-status"]')).toBeNull();
      expect(host?.querySelector('[data-testid="attention-authorization-row"]')?.textContent).toContain(
        '由系统通知设置管理',
      );
      await act(async () => {
        host?.querySelector<HTMLButtonElement>('[data-testid="attention-open-system-settings"]')?.click();
      });
      expect(os.openSystemSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('AN-T47 preference switches', () => {
    it('renders eight preference switches', async () => {
      await renderPage(createFakeOs('granted'));
      for (const key of [
        'enabled',
        'onNeedsInput',
        'onComplete',
        'onFailure',
        'foregroundToast',
        'badge',
        'sound',
        'bounceOnNeedsInput',
      ] as const) {
        const input = host?.querySelector<HTMLInputElement>(`[data-testid="attention-pref-${key}"]`);
        expect(input, key).toBeTruthy();
        expect(input?.checked).toBe(true);
      }
    });

    it('asks for confirmation before turning off onNeedsInput and keeps the value on cancel', async () => {
      await renderPage(createFakeOs('granted'));
      const input = host?.querySelector<HTMLInputElement>('[data-testid="attention-pref-onNeedsInput"]');
      expect(input?.checked).toBe(true);
      await act(async () => {
        input?.click();
      });
      expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeTruthy();
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-cancel"]')?.click();
      });
      expect(readAttentionPreferences(storage).onNeedsInput).toBe(true);
      expect(storage.getItem(ATTENTION_PREFERENCES_KEY)).toBeNull();
      expect(host?.querySelector<HTMLInputElement>('[data-testid="attention-pref-onNeedsInput"]')?.checked).toBe(
        true,
      );
    });

    it('writes onNeedsInput=false after confirm', async () => {
      await renderPage(createFakeOs('granted'));
      await act(async () => {
        host?.querySelector<HTMLInputElement>('[data-testid="attention-pref-onNeedsInput"]')?.click();
      });
      await act(async () => {
        document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')?.click();
      });
      expect(readAttentionPreferences(storage).onNeedsInput).toBe(false);
    });

    it('writes the master switch without confirmation', async () => {
      await renderPage(createFakeOs('granted'));
      await act(async () => {
        host?.querySelector<HTMLInputElement>('[data-testid="attention-pref-enabled"]')?.click();
      });
      expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
      expect(readAttentionPreferences(storage).enabled).toBe(false);
    });

    it('does not confirm when turning onNeedsInput back on', async () => {
      writeAttentionPreferences(
        { ...DEFAULT_ATTENTION_PREFERENCES, onNeedsInput: false },
        storage,
      );
      await renderPage(createFakeOs('granted'));
      await act(async () => {
        host?.querySelector<HTMLInputElement>('[data-testid="attention-pref-onNeedsInput"]')?.click();
      });
      expect(document.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
      expect(readAttentionPreferences(storage).onNeedsInput).toBe(true);
    });
  });
});
