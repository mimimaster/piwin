// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { McpToolCatalogRow } from './mcp-tool-catalog-row';
import type { McpToolCatalogEntry } from './mcp-visibility-model';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const entry: McpToolCatalogEntry = {
  serverId: 'agent-memory',
  name: 'agent_memory_search',
  selector: 'agent-memory.agent_memory_search',
  exposedName: 'mcp__agent-memory__agent_memory_search',
  description: 'Search project memories with hybrid retrieval.',
  exposure: 'gateway',
  source: 'live',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Natural language query' },
      project: { type: 'string', description: 'Project scope' },
    },
  },
};

describe('McpToolCatalogRow', () => {
  let previousActEnvironment: boolean | undefined;
  const mounted: Array<{ container: HTMLElement; root: Root }> = [];

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    for (const { container, root } of mounted) {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
    mounted.length = 0;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function renderRow(node: ReactElement): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
    mounted.push({ container, root });
    return container;
  }

  it('expands to show description and schema parameters', () => {
    const container = renderRow(<McpToolCatalogRow entry={entry} isChinese />);
    expect(container.querySelector('[data-testid="mcp-tool-catalog-body-agent-memory.agent_memory_search"]')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="mcp-tool-catalog-toggle-agent-memory.agent_memory_search"]',
        )
        ?.click();
    });

    const body = container.querySelector(
      '[data-testid="mcp-tool-catalog-body-agent-memory.agent_memory_search"]',
    );
    expect(body?.textContent).toContain('hybrid retrieval');
    expect(body?.textContent).toContain('query');
    expect(body?.textContent).toContain('必填');
    expect(body?.textContent).toContain('Natural language query');
    expect(body?.textContent).toContain('原始 JSON Schema');
  });
});
