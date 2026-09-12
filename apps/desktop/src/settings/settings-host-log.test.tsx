// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { DesktopLocaleProvider } from '../desktop-locale-context.js';
import { HostLogProvider } from '../host-log-context.js';
import type { HostLogEntry } from '../HostLogPanel.js';
import { SettingsHostLogSection } from './settings-host-log.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const SAMPLE_ENTRIES: HostLogEntry[] = [
  { id: 1, level: 'info', message: 'ready', at: '2026-09-12T00:00:00.000Z' },
  { id: 2, level: 'warn', message: 'slow tool', at: '2026-09-12T00:00:01.000Z' },
  { id: 3, level: 'error', message: 'mcp failed', at: '2026-09-12T00:00:02.000Z' },
];

let mounted: { container: HTMLDivElement; root: Root } | null = null;

function renderSection(options?: {
  entries?: HostLogEntry[];
  locale?: 'en' | 'zh-CN';
  onClear?: () => void;
}): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale={options?.locale ?? 'en'} onLocaleChange={() => {}}>
          <HostLogProvider
            value={{
              entries: options?.entries ?? SAMPLE_ENTRIES,
              onClear: options?.onClear ?? (() => undefined),
            }}
          >
            <SettingsHostLogSection />
          </HostLogProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  mounted = { container, root };
  return container;
}

describe('SettingsHostLogSection', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    if (mounted) {
      act(() => {
        mounted?.root.unmount();
      });
      mounted.container.remove();
      mounted = null;
    }
  });

  it('hides when the host-log context is missing', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsHostLogSection />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="settings-host-log"]')).toBeNull();
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a settings card with ui-kit filter and empty copy', () => {
    const container = renderSection({ entries: [] });
    expect(container.querySelector('[data-testid="settings-host-log"]')?.textContent).toContain(
      'Host log',
    );
    expect(container.querySelector('[data-testid="settings-host-log-count"]')?.textContent).toBe(
      '0',
    );
    expect(container.querySelector('[data-testid="settings-host-log-empty"]')?.textContent).toBe(
      'No host log lines yet.',
    );
    expect(container.querySelector('[data-testid="settings-host-log-level"]')).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="settings-host-log-copy"]')
        ?.disabled,
    ).toBe(true);
  });

  it('lists lines and filters by level', () => {
    const container = renderSection();
    expect(container.querySelectorAll('.settings-host-log-line')).toHaveLength(3);
    expect(container.textContent).toContain('mcp failed');

    const levelHost = container.querySelector('[data-testid="settings-host-log-level"]');
    const select =
      levelHost instanceof HTMLSelectElement
        ? levelHost
        : levelHost?.querySelector('select');
    expect(select).toBeTruthy();
    act(() => {
      if (!select) return;
      select.value = 'error';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.querySelectorAll('.settings-host-log-line')).toHaveLength(1);
    expect(container.textContent).toContain('mcp failed');
    expect(container.textContent).not.toContain('slow tool');
  });

  it('clears through the provided callback', () => {
    const onClear = vi.fn();
    const container = renderSection({ onClear });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="settings-host-log-clear"]')?.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('uses Chinese copy on zh-CN', () => {
    const container = renderSection({ entries: [], locale: 'zh-CN' });
    expect(container.textContent).toContain('Host 日志');
    expect(container.querySelector('[data-testid="settings-host-log-empty"]')?.textContent).toBe(
      '暂无 Host 日志。',
    );
    expect(container.querySelector('[data-testid="settings-host-log-copy"]')?.textContent).toBe(
      '复制',
    );
  });
});
