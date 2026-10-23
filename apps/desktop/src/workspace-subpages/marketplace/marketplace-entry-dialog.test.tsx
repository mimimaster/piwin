// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { MarketplaceCatalogEntry } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../theme/appearance-tokens.js';
import { MarketplaceEntryDialog } from './marketplace-entry-dialog.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (activeRoot) {
    act(() => activeRoot?.unmount());
  }
  activeRoot = null;
  container?.remove();
  container = null;
  document.body.querySelectorAll('[data-testid="marketplace-entry-dialog"]').forEach((node) => {
    node.remove();
  });
});

const BASE_ENTRY: MarketplaceCatalogEntry = {
  entryId: 'extension:test-ext',
  capabilityId: 'test-ext',
  kind: 'extension',
  category: 'code-development',
  name: { en: 'Test Extension', zhCN: '测试扩展' },
  summary: { en: 'Summary', zhCN: '概述' },
  description: { en: 'Description', zhCN: '描述' },
  version: '1.0.0',
  author: 'Tester',
  sourceLabel: 'npm',
  install: {
    kind: 'pi-package',
    source: { kind: 'npm', packageName: 'test-ext', version: '1.0.0' },
  },
  requirements: [],
  examples: [],
  verification: [{ level: 'author-declared' }],
  featured: false,
};

function renderDialog(entry: MarketplaceCatalogEntry) {
  container = document.createElement('div');
  document.body.appendChild(container);
  activeRoot = createRoot(container);
  act(() => {
    activeRoot?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <MarketplaceEntryDialog
          entry={entry}
          installed={undefined}
          operation={undefined}
          locale="zh-CN"
          onInstall={vi.fn()}
          onClose={vi.fn()}
        />
      </PiwinUiProvider>,
    );
  });
}

describe('MarketplaceEntryDialog compatibility note', () => {
  it('shows compatibility note for untested extension', () => {
    renderDialog({
      ...BASE_ENTRY,
      kind: 'extension',
      verification: [{ level: 'author-declared' }],
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).toContain('piwin 尚未实测此版本；安装后由 Host 做兼容性检查。');
  });

  it('does not show compatibility note for tested extension', () => {
    renderDialog({
      ...BASE_ENTRY,
      kind: 'extension',
      verification: [
        {
          level: 'piwin-tested',
          testedVersion: '1.0.0',
          piwinVersion: '0.1.0',
          piVersion: '0.1.0',
          hostOs: 'macos',
          backend: 'sdk',
          testedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).not.toContain('piwin 尚未实测此版本；安装后由 Host 做兼容性检查。');
  });

  it('does not show compatibility note for untested skill', () => {
    renderDialog({
      ...BASE_ENTRY,
      entryId: 'skill:test-skill',
      capabilityId: 'test-skill',
      kind: 'skill',
      install: {
        kind: 'skill',
        source: { kind: 'git', url: 'https://example.com/skill.git', ref: 'main' },
      },
      verification: [{ level: 'author-declared' }],
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).not.toContain('piwin 尚未实测此版本；安装后由 Host 做兼容性检查。');
  });

  it('does not show compatibility note for untested mcp', () => {
    renderDialog({
      ...BASE_ENTRY,
      entryId: 'mcp:test-mcp',
      capabilityId: 'test-mcp',
      kind: 'mcp',
      install: {
        kind: 'mcp',
        serverId: 'test-mcp',
        draft: { command: 'node', args: ['server.js'] },
      },
      verification: [{ level: 'author-declared' }],
    });
    const dialog = document.querySelector('[data-testid="marketplace-entry-dialog"]');
    expect(dialog?.textContent).not.toContain('piwin 尚未实测此版本；安装后由 Host 做兼容性检查。');
  });
});
