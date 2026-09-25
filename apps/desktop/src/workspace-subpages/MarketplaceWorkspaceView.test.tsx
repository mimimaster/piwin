// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
} from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { findButton, flush, setInputValue } from './workspace-subpages-test-helpers.js';
import { MarketplaceWorkspaceView } from './MarketplaceWorkspaceView.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SKILL_ENTRY: MarketplaceCatalogEntry = {
  entryId: 'skill:doc-coauthoring',
  capabilityId: 'doc-coauthoring',
  kind: 'skill',
  category: 'docs-research',
  name: { en: 'Doc Co-authoring', zhCN: '文档协作写作' },
  summary: { en: 'Structured docs', zhCN: '结构化写文档' },
  description: { en: 'Structured docs', zhCN: '结构化写文档' },
  version: 'a'.repeat(40),
  author: 'Anthropic',
  sourceLabel: 'GitHub',
  install: {
    kind: 'skill',
    source: { kind: 'git', url: 'https://github.com/anthropics/skills.git', ref: 'a'.repeat(40) },
  },
  requirements: [],
  examples: [{ title: { en: 'Write', zhCN: '写提案' }, prompt: { en: 'Write a proposal', zhCN: '帮我写提案' } }],
  verification: [{ level: 'author-declared' }],
  featured: true,
};

const EXTENSION_ENTRY: MarketplaceCatalogEntry = {
  ...SKILL_ENTRY,
  entryId: 'extension:pi-lens',
  capabilityId: 'pi-lens',
  kind: 'extension',
  category: 'code-development',
  name: { en: 'pi-lens', zhCN: 'pi-lens 代码反馈' },
  summary: { en: 'Code feedback', zhCN: '代码反馈' },
  version: '4.2.1',
  sourceLabel: 'npm',
  install: { kind: 'pi-package', source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' } },
};

type FakeHost = {
  request: ReturnType<typeof vi.fn>;
  commands: () => HostCommand[];
  setItems: (items: MarketplaceInstalledItem[]) => void;
  emit: (message: HostServerMessage) => void;
  subscribe: (listener: (message: HostServerMessage) => void) => () => void;
};

function ok(command: string, data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

function createFakeHost(overrides: Partial<Record<HostCommand['type'], (command: HostCommand) => HostResponse>> = {}): FakeHost {
  let items: MarketplaceInstalledItem[] = [];
  const listeners = new Set<(message: HostServerMessage) => void>();
  const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
    const override = overrides[command.type];
    if (override) return override(command);
    switch (command.type) {
      case 'marketplace/catalog-list':
        return ok(command.type, { entries: [EXTENSION_ENTRY, SKILL_ENTRY] });
      case 'marketplace/installed-list':
        return ok(command.type, { revision: String(items.length), items });
      default:
        return ok(command.type, {});
    }
  });
  return {
    request,
    commands: () => request.mock.calls.map(([command]) => command as HostCommand),
    setItems: (next) => {
      items = next;
    },
    emit: (message) => {
      for (const listener of listeners) listener(message);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function installedItem(overrides: Partial<MarketplaceInstalledItem>): MarketplaceInstalledItem {
  return {
    installationKey: 'skill:doc-coauthoring',
    capabilityId: 'doc-coauthoring',
    kind: 'skill',
    name: 'doc-coauthoring',
    catalogEntryId: 'skill:doc-coauthoring',
    availability: 'available',
    enabled: true,
    source: 'user',
    canToggle: true,
    removal: { command: 'skills/uninstall' },
    ...overrides,
  };
}

describe('MarketplaceWorkspaceView', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function render(host: FakeHost, extra: { sessionId?: string; onUseExample?: (text: string) => void } = {}): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <MarketplaceWorkspaceView
            locale="zh-CN"
            onClose={vi.fn()}
            request={host.request}
            subscribeHostMessages={host.subscribe}
            {...(extra.sessionId ? { sessionId: extra.sessionId } : {})}
            {...(extra.onUseExample ? { onUseExample: extra.onUseExample } : {})}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders the Host catalog grouped by scenario, with no simulated runtime badge', async () => {
    const host = createFakeHost();
    render(host);
    await flush();

    expect(host.commands().map((command) => command.type)).toEqual(
      expect.arrayContaining(['marketplace/catalog-list', 'marketplace/installed-list']),
    );
    expect(container.querySelector('[data-testid="market-group-code-development"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="market-group-docs-research"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="market-group-design-content"]')).toBeNull();
    expect(container.textContent).toContain('作者声明');
    expect(container.textContent).not.toContain('Runtime Gen');
  });

  it('installs a Skill through skills/install and shows the Host-reported state afterwards', async () => {
    const host = createFakeHost({
      'skills/install': (command) => {
        host.setItems([installedItem({})]);
        return ok(command.type, { skillId: 'doc-coauthoring', targetPath: '/tmp/x' });
      },
    });
    render(host);
    await flush();

    const card = container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]');
    act(() => {
      findButton(card ?? container, '查看并安装')?.click();
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).toContain('可能附带');
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')?.click();
    });
    await flush();

    expect(host.commands()).toContainEqual({
      type: 'skills/install',
      source: SKILL_ENTRY.install.kind === 'skill' ? SKILL_ENTRY.install.source : undefined,
    });
    expect(card?.textContent).toContain('当前可用');
  });

  it('installs a pinned Pi package and says it is queued, not live, while the run continues', async () => {
    const host = createFakeHost({
      'extensions/apply': (command) =>
        ok(command.type, { sessionId: 's1', deploymentId: 'd1', state: 'waiting-current-run', when: 'after-current-run', registryRevision: 'r' }),
    });
    render(host, { sessionId: 's1' });
    await flush();

    act(() => {
      findButton(container.querySelector('[data-testid="market-entry-extension:pi-lens"]') ?? container, '查看并安装')?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')?.click();
    });
    await flush();

    const sent = host.commands();
    expect(sent).toContainEqual({
      type: 'marketplace/package-install',
      source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' },
    });
    expect(sent).toContainEqual({ type: 'extensions/apply', sessionId: 's1', when: 'after-current-run' });
    expect(document.body.textContent).toContain('当前任务结束后同步到本会话');
    expect(document.body.textContent).not.toContain('已无缝就绪');
  });

  it('reports a failed install as failure and leaves the entry uninstalled', async () => {
    const host = createFakeHost({
      'skills/install': (command) => ({ type: 'response', command: command.type, success: false, error: 'git clone failed' }),
    });
    render(host);
    await flush();
    act(() => {
      findButton(container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]') ?? container, '查看并安装')?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')?.click();
    });
    await flush();

    expect(document.body.textContent).toContain('git clone failed');
    expect(container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]')?.textContent).not.toContain('当前可用');
  });

  it('uninstalls from the Installed tab only after confirmation, using the Host removal route', async () => {
    const host = createFakeHost({
      'skills/uninstall': (command) => {
        host.setItems([]);
        return ok(command.type, { skillId: 'doc-coauthoring' });
      },
    });
    host.setItems([installedItem({ availability: 'pending-apply', message: 'Applies later' })]);
    render(host);
    await flush();

    act(() => {
      findButton(container, '已安装')?.click();
    });
    const row = container.querySelector('[data-testid="market-installed-skill:doc-coauthoring"]');
    expect(row?.textContent).toContain('待应用');
    act(() => {
      findButton(row ?? container, '卸载')?.click();
    });
    expect(host.commands().some((command) => command.type === 'skills/uninstall')).toBe(false);
    act(() => {
      findButton(document.querySelector('[data-testid="marketplace-remove-confirm"]') ?? document.body, '卸载')?.click();
    });
    await flush();

    expect(host.commands()).toContainEqual({ type: 'skills/uninstall', skillId: 'doc-coauthoring' });
    expect(container.querySelector('[data-testid="market-installed-skill:doc-coauthoring"]')).toBeNull();
  });

  it('re-reads the inventory when the Host pushes an inventory change', async () => {
    const host = createFakeHost();
    render(host);
    await flush();
    const before = host.commands().filter((command) => command.type === 'marketplace/installed-list').length;

    host.setItems([installedItem({})]);
    act(() => {
      host.emit({ type: 'marketplace/inventory-updated', revision: '1', changedKinds: ['skill'] });
    });
    await flush();

    const after = host.commands().filter((command) => command.type === 'marketplace/installed-list').length;
    expect(after).toBe(before + 1);
    expect(container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]')?.textContent).toContain('当前可用');
  });

  it('offers the example request to the composer once the capability is usable', async () => {
    const host = createFakeHost();
    host.setItems([installedItem({})]);
    const onUseExample = vi.fn();
    render(host, { onUseExample });
    await flush();
    act(() => {
      findButton(container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]') ?? container, '详情')?.click();
    });
    act(() => {
      findButton(document.querySelector('[data-testid="marketplace-entry-dialog"]') ?? document.body, '填入输入框')?.click();
    });
    expect(onUseExample).toHaveBeenCalledWith('帮我写提案');
  });

  it('shows a Host read failure instead of pretending the inventory is empty', async () => {
    const host = createFakeHost({
      'marketplace/installed-list': (command) => ({ type: 'response', command: command.type, success: false, error: 'host offline' }),
    });
    render(host);
    await flush();
    expect(container.querySelector('[data-testid="marketplace-host-error"]')?.textContent).toContain('host offline');
  });

  it('does not search ecosystem on typing alone, but adds results on Enter or search submit', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: 'lens',
          hits: [
            {
              entryId: 'npm:pi-lens-extra',
              name: 'pi-lens-extra',
              version: '1.0.0',
              description: 'x',
              source: 'npm-pi-package',
              installCommand: 'pi install npm:pi-lens-extra',
            },
          ],
        }),
    });
    render(host);
    await flush();

    const input = container.querySelector<HTMLInputElement>('[data-testid="marketplace-search-input"]');
    act(() => {
      setInputValue(input, 'lens');
    });
    await flush();

    // Local catalog is filtered immediately without network request:
    expect(container.querySelector('[data-testid="market-entry-extension:pi-lens"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="market-entry-skill:doc-coauthoring"]')).toBeNull();
    // Ecosystem search is NOT triggered by typing alone:
    expect(host.commands().some((c) => c.type === 'marketplace/search')).toBe(false);
    expect(container.querySelector('[data-testid="marketplace-ecosystem"]')).toBeNull();

    // Submit search via Enter key:
    act(() => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await flush();

    expect(host.commands().some((c) => c.type === 'marketplace/search')).toBe(true);
    expect(container.querySelector('[data-testid="marketplace-ecosystem"]')?.textContent).toContain('pi-lens-extra');
  });

  it('reports ecosystem search errors via toast and does not render in-page notice banner', async () => {
    const host = createFakeHost({
      'marketplace/search': (command) =>
        ok(command.type, {
          query: 'failing-package',
          hits: [],
          remoteError: 'GitHub: GitHub search failed: HTTP 403',
        }),
    });
    render(host);
    await flush();

    const input = container.querySelector<HTMLInputElement>('[data-testid="marketplace-search-input"]');
    act(() => {
      setInputValue(input, 'failing-package');
    });
    await flush();

    // Submit via clickable search button:
    const submitBtn = container.querySelector<HTMLButtonElement>('[data-testid="vault-search-submit-btn"]');
    expect(submitBtn).not.toBeNull();
    act(() => {
      submitBtn?.click();
    });
    await flush();

    // In-page Notice banner must NOT be rendered:
    expect(container.querySelector('[data-testid="marketplace-ecosystem-error"]')).toBeNull();
    // Toast must show the error:
    expect(document.body.textContent).toContain('GitHub: GitHub search failed: HTTP 403');
  });
  it('shows a progress bar on the card while installing, then an app toast', async () => {
    let finish: (() => void) | undefined;
    const host = createFakeHost({});
    host.request.mockImplementation(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list') return ok(command.type, { entries: [SKILL_ENTRY] });
      if (command.type === 'marketplace/installed-list') return ok(command.type, { revision: '0', items: [] });
      if (command.type === 'skills/install') {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return ok(command.type, { skillId: 'doc-coauthoring', targetPath: '/tmp/x' });
      }
      return ok(command.type, {});
    });
    render(host);
    await flush();
    act(() => {
      findButton(container, '查看并安装')?.click();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="marketplace-entry-install"]')?.click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="market-entry-progress-skill:doc-coauthoring"]'),
    ).not.toBeNull();

    await act(async () => {
      finish?.();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="market-entry-progress-skill:doc-coauthoring"]'),
    ).toBeNull();
    expect(document.body.textContent).toContain('下一条消息起即可使用');
  });
});
