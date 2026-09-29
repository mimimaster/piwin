// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ExtensionSummary, ExtensionUiSurfaceSnapshot } from '@piwin/contracts';
import { ExtensionSurfaceStrip } from './extension-surface-strip';
import { listExtensionSlashCommands } from './hooks/use-extension-slash-commands';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(element: React.ReactElement): HTMLElement {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

const surface: ExtensionUiSurfaceSnapshot = {
  sessionId: 's1',
  statuses: [{ key: 'git', text: 'main · 3 staged' }],
  widgets: [
    { key: 'todo', lines: ['- [ ] write docs', '- [x] ship'], placement: 'aboveEditor' },
    { key: 'log', lines: ['<b>not html</b>'], placement: 'belowEditor' },
  ],
  workingMessage: 'Indexing…',
};

describe('ExtensionSurfaceStrip', () => {
  it('renders above-editor widgets as plain text', () => {
    const view = render(<ExtensionSurfaceStrip surface={surface} placement="aboveEditor" />);
    expect(view.querySelector('[data-widget-key="todo"]')?.textContent).toBe(
      '- [ ] write docs\n- [x] ship',
    );
    expect(view.querySelector('[role="status"]')).toBeNull();
  });

  it('renders below-editor widgets as plain text and leaves statuses to the stats line', () => {
    const view = render(<ExtensionSurfaceStrip surface={surface} placement="belowEditor" />);
    const log = view.querySelector('[data-widget-key="log"]');
    expect(log?.textContent).toBe('<b>not html</b>');
    expect(log?.querySelector('b')).toBeNull();
    expect(view.querySelector('[role="status"]')).toBeNull();
    expect(view.textContent).not.toContain('main · 3 staged');
  });

  it('renders nothing when an extension only publishes statuses', () => {
    const statusOnly = { sessionId: 's1', statuses: [{ key: 'cache', text: 'Cache 80%' }], widgets: [] };
    expect(
      render(<ExtensionSurfaceStrip surface={statusOnly} placement="belowEditor" />).innerHTML,
    ).toBe('');
  });

  it('renders nothing for an empty or missing surface', () => {
    expect(render(<ExtensionSurfaceStrip surface={null} placement="belowEditor" />).innerHTML).toBe('');
    act(() => root?.unmount());
    const empty = { sessionId: 's1', statuses: [], widgets: [] };
    expect(render(<ExtensionSurfaceStrip surface={empty} placement="belowEditor" />).innerHTML).toBe(
      '',
    );
  });
});

describe('listExtensionSlashCommands', () => {
  it('lists commands of enabled extensions once, first registration wins', () => {
    const extension = (
      id: string,
      enabled: boolean,
      commands: string[],
    ): ExtensionSummary => ({
      id,
      name: id,
      description: '',
      source: 'user',
      path: `/x/${id}`,
      enabled,
      compatibility: { tier: 'compatible', capabilities: { tools: [], hooks: [], commands } },
    });
    expect(
      listExtensionSlashCommands([
        extension('a', true, ['cache-stats', 'Wiki']),
        extension('b', false, ['disabled-cmd']),
        extension('c', true, ['wiki', 'graph']),
      ]),
    ).toEqual([
      { name: 'cache-stats', extensionId: 'a', extensionName: 'a' },
      { name: 'Wiki', extensionId: 'a', extensionName: 'a' },
      { name: 'graph', extensionId: 'c', extensionName: 'c' },
    ]);
  });
});
