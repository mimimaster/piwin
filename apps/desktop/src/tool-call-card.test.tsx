// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ToolCardUi } from './chat-reducer';
import { ToolCallCard } from './tool-call-card';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createReadTool(overrides?: Partial<ToolCardUi>): ToolCardUi {
  return {
    toolCallId: 'tool-read-1',
    toolName: 'read',
    status: 'done',
    output: 'file contents',
    presentation: {
      title: 'Read',
      kind: 'filesystem',
      actionVerb: 'Read',
      summary: 'pelican-bicycle-animation.html',
      targetPaths: ['pelican-bicycle-animation.html'],
      output: { text: 'file contents', truncated: true },
    },
    ...overrides,
  };
}

describe('ToolCallCard openable file paths', () => {
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
  });

  it('opens the primary Read target from the file pill without expanding the card', () => {
    const onOpenFile = vi.fn();

    act(() => {
      root.render(
        <ToolCallCard
          tool={createReadTool()}
          projectPath="/workspace"
          density="comfortable"
          onOpenFile={onOpenFile}
        />,
      );
    });

    const filePill = container.querySelector<HTMLButtonElement>(
      '[data-testid="tool-call-file-pill"]',
    );
    expect(filePill).not.toBeNull();
    expect(filePill?.tagName).toBe('BUTTON');
    expect(filePill?.classList.contains('is-openable')).toBe(true);
    expect(filePill?.getAttribute('data-full-path')).toBe(
      '/workspace/pelican-bicycle-animation.html',
    );
    expect(container.querySelector('[data-testid="tool-call-output-truncated"]')).not.toBeNull();
    expect(container.querySelector('.tool-call-card')?.classList.contains('is-expanded')).toBe(
      false,
    );

    act(() => {
      filePill?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith(
      '/workspace/pelican-bicycle-animation.html',
      'pelican-bicycle-animation.html',
    );
    expect(container.querySelector('.tool-call-card')?.classList.contains('is-expanded')).toBe(
      false,
    );
  });

  it('opens expanded body path links for multi-file tools', () => {
    const onOpenFile = vi.fn();
    const multiFileTool = createReadTool({
      presentation: {
        title: 'Read',
        kind: 'filesystem',
        actionVerb: 'Read',
        summary: 'a.html and 1 other file',
        targetPaths: ['docs/a.html', 'docs/b.html'],
      },
    });

    act(() => {
      root.render(
        <ToolCallCard
          tool={multiFileTool}
          projectPath="/workspace"
          density="detailed"
          defaultExpanded
          onOpenFile={onOpenFile}
        />,
      );
    });

    const pathLinks = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="tool-call-path-link"]'),
    );
    expect(pathLinks).toHaveLength(2);

    act(() => {
      pathLinks[0]?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith('/workspace/docs/a.html', 'docs/a.html');
  });

  it('keeps the file pill non-interactive when onOpenFile is absent', () => {
    act(() => {
      root.render(
        <ToolCallCard tool={createReadTool()} projectPath="/workspace" density="comfortable" />,
      );
    });

    const filePill = container.querySelector<HTMLElement>('[data-testid="tool-call-file-pill"]');
    expect(filePill).not.toBeNull();
    expect(filePill?.tagName).toBe('SPAN');
    expect(filePill?.classList.contains('is-openable')).toBe(false);
  });

  it('binds MCP rows to the stable behavior id and localized active label', () => {
    const mcpTool: ToolCardUi = {
      toolCallId: 'mcp-1',
      toolName: 'mcp__github__search',
      status: 'running',
      output: '',
      presentation: {
        title: 'github / search',
        kind: 'mcp',
        actionVerb: 'MCP (github)',
        summary: '{"query":"piwin"}',
        inputPreview: '{"query":"piwin"}',
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={mcpTool} density="comfortable" locale="zh-CN" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-activity-id')).toBe('mcp.call');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('调用');
    expect(card?.querySelector('.tool-call-action-verb')?.className).toContain(
      'behavior-mcp-active',
    );
    expect(card?.getAttribute('data-activity-animation')).toBe('breath-dot');
    expect(card?.querySelector('.tool-call-preview')?.textContent).not.toContain('query');
  });

  it('uses a terminal MCP behavior id and past-tense label after completion', () => {
    const mcpTool: ToolCardUi = {
      toolCallId: 'mcp-done-1',
      toolName: 'mcp__github__search',
      status: 'done',
      output: '12 results',
      presentation: {
        title: 'github / search',
        kind: 'mcp',
        actionVerb: 'MCP (github)',
        summary: 'search',
        output: { text: '12 results' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={mcpTool} density="comfortable" locale="en" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-activity-id')).toBe('mcp.call.done');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Called');
    expect(card?.getAttribute('data-activity-animation')).toBe('none');
  });

  it('renders fetch-like shell commands with the reference request surface', () => {
    const fetchTool: ToolCardUi = {
      toolCallId: 'fetch-shell-1',
      toolName: 'bash',
      status: 'done',
      output: 'raw response',
      presentation: {
        title: 'Bash',
        kind: 'shell',
        actionVerb: 'Ran command',
        summary: 'Fetch new subscription link',
        command: '# Fetch new subscription link\ncurl -s -L "https://example.com/link"',
        output: { text: 'raw response' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={fetchTool} density="detailed" locale="en" defaultExpanded />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-visual')).toBe('fetch');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Ran');
    expect(card?.querySelector('.tool-call-preview')?.textContent).toBe(
      'Fetch new subscription link',
    );
    expect(card?.querySelector('[data-testid="tool-call-fetch-panel"]')?.textContent).toContain(
      '$# Fetch new subscription link',
    );
  });

  it('renders native web_fetch requests in the same code surface', () => {
    const fetchTool: ToolCardUi = {
      toolCallId: 'fetch-web-1',
      toolName: 'web_fetch',
      status: 'done',
      output: JSON.stringify({
        url: 'https://example.com/docs',
        finalUrl: 'https://example.com/docs',
        title: 'Docs',
        text: 'Readable page text',
      }),
      presentation: {
        title: 'web_fetch',
        kind: 'web',
        actionVerb: 'Fetched',
        summary: 'https://example.com/docs',
        inputPreview: '{"url":"https://example.com/docs"}',
        output: { text: '{"url":"https://example.com/docs"}' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={fetchTool} density="detailed" locale="en" defaultExpanded />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.getAttribute('data-tool-visual')).toBe('fetch');
    expect(card?.querySelector('[data-testid="tool-call-fetch-panel"]')?.textContent).toContain(
      'GET https://example.com/docs',
    );
    expect(card?.querySelector('.citation-card')).not.toBeNull();
  });
});
