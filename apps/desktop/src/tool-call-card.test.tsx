// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { ToolCardUi } from './chat-reducer';
import { collectSessionTools, resolveToolOpenPath, ToolCallCard } from './tool-call-card';

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

  it('opens the file from the collapsed read summary instead of expanding', () => {
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

    const filePill = container.querySelector<HTMLElement>('[data-testid="tool-call-file-pill"]');
    expect(filePill).not.toBeNull();
    expect(filePill?.classList.contains('is-link')).toBe(true);
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

  it('shows the recovered read range next to the filename', () => {
    act(() => {
      root.render(
        <ToolCallCard
          tool={createReadTool({
            presentation: {
              title: 'Read',
              kind: 'filesystem',
              actionVerb: 'Read',
              inputPreview: '{"path":"src/tool-group-clustering.ts","offset":1,"limit":80}',
            },
          })}
          projectPath="/workspace"
          density="comfortable"
          onOpenFile={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('[data-testid="tool-call-file-pill"]')?.textContent).toContain(
      'tool-group-clustering.ts',
    );
    expect(container.querySelector('[data-testid="tool-call-line-range"]')?.textContent).toBe(
      'L1-80',
    );
  });

  it('replaces the raw truncation label with a compact localized summary', () => {
    const tool = createReadTool({
      presentation: {
        title: 'Read',
        kind: 'filesystem',
        actionVerb: 'Read',
        summary: 'large.ts',
        targetPaths: ['src/large.ts'],
        output: {
          text: 'line 1',
          truncated: true,
          truncation: {
            reason: 'line-limit',
            shownLines: { start: 1, end: 2000 },
            totalLines: 6280,
            nextOffset: 2001,
            limitLines: 2000,
          },
        },
      },
    });

    act(() => {
      root.render(<ToolCallCard tool={tool} density="compact" locale="zh-CN" />);
    });

    const tag = container.querySelector('[data-testid="tool-call-output-truncated"]');
    expect(tag?.textContent).toBe('部分内容 · L1–L2000 / 共 6280 行');
    expect(tag?.textContent).not.toContain('truncated');

    act(() => {
      container.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });

    expect(
      container.querySelector('[data-testid="tool-call-output-notice"]')?.textContent,
    ).toContain('文件未修改');
    expect(
      container.querySelector('[data-testid="tool-call-output-notice"]')?.textContent,
    ).toContain('第 2001 行');
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

  it('keeps the file pill a non-nested code chip so the row can expand', () => {
    act(() => {
      root.render(
        <ToolCallCard tool={createReadTool()} projectPath="/workspace" density="comfortable" />,
      );
    });

    const filePill = container.querySelector<HTMLElement>('[data-testid="tool-call-file-pill"]');
    expect(filePill).not.toBeNull();
    expect(filePill?.tagName).toBe('CODE');
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
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('MCP');
    expect(card?.querySelector('.tool-call-action-verb')?.className).toContain(
      'behavior-mcp-active',
    );
    expect(card?.getAttribute('data-activity-animation')).toBe('breath-dot');
    expect(card?.classList.contains('is-expanded')).toBe(true);
    // Expanded MCP rows keep server/tool identity in the header preview.
    expect(card?.querySelector('.tool-call-preview')?.textContent).toContain('github / search');
    expect(card?.querySelector('[data-testid="tool-call-input-preview"]')?.textContent).toContain(
      'piwin',
    );
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
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('MCP');
    expect(card?.querySelector('.tool-call-preview')?.textContent).toContain('github / search');
    expect(card?.getAttribute('data-activity-animation')).toBe('none');
  });

  it('shows a collapsed MCP identity instead of a bare MCP chip', () => {
    const mcpTool: ToolCardUi = {
      toolCallId: 'mcp-memory-1',
      toolName: 'mcp__agent-memory__agent_memory_get_context',
      status: 'done',
      output: '{}',
      presentation: {
        title: 'agent-memory / agent_memory_get_context',
        kind: 'mcp',
        actionVerb: 'MCP (agent-memory)',
        summary: 'agent_memory_get_context',
        inputPreview: '{"project":"piwin"}',
        output: { text: '{}' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={mcpTool} density="compact" locale="zh-CN" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('MCP');
    expect(card?.querySelector('.tool-call-preview')?.textContent).toBe(
      'agent-memory / agent_memory_get_context',
    );
    expect(card?.querySelector('.tool-call-preview')?.textContent).not.toContain('project');
  });

  it('keeps agent-memory identity and shows args plus result when expanded', () => {
    const mcpTool: ToolCardUi = {
      toolCallId: 'mcp-memory-expanded',
      toolName: 'mcp__agent-memory__agent_memory_search',
      status: 'done',
      output: '[{"content":"remembered fact"}]',
      presentation: {
        title: 'agent-memory / agent_memory_search',
        kind: 'mcp',
        actionVerb: 'MCP (agent-memory)',
        summary: 'agent_memory_search',
        inputPreview: '{"project":"piwin","query":"how did we fix canvas"}',
        output: { text: '[{"content":"remembered fact"}]' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={mcpTool} density="detailed" locale="zh-CN" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(true);
    expect(card?.querySelector('.tool-call-preview')?.textContent).toContain(
      'agent-memory / agent_memory_search',
    );
    expect(card?.querySelector('[data-testid="tool-call-input-preview"]')?.textContent).toContain(
      'how did we fix canvas',
    );
    expect(card?.querySelector('.tool-call-output')?.textContent).toContain('remembered fact');
  });

  it('keeps raw execution errors out of the summary row', () => {
    const failedTool: ToolCardUi = {
      toolCallId: 'shell-error-1',
      toolName: 'bash',
      status: 'error',
      output: 'Tool error (execution-failed): Command failed',
      presentation: {
        title: 'Bash',
        kind: 'shell',
        actionVerb: 'Ran command',
        summary: 'Tool error (execution-failed): Command failed',
        command: 'ls ~/.piwin',
        error: { category: 'execution', message: 'Command failed' },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={failedTool} density="compact" locale="zh-CN" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Bash');
    expect(card?.querySelector('.tool-call-summary')?.textContent).not.toContain('Tool error');
    expect(card?.querySelector('.tool-call-body')?.textContent).toContain('Command failed');
    expect(card?.querySelector('[data-testid="tool-call-error"]')?.textContent).toContain(
      'Command failed',
    );
    // Same failure string must not also render as a raw output pre.
    expect(card?.querySelector('.tool-call-output')).toBeNull();
    expect(card?.querySelector('[data-testid="tool-call-err"]')).not.toBeNull();
  });

  it('keeps longer stderr under a structured error when it adds detail', () => {
    const stderr = [
      'Command failed: ls /missing',
      'ls: /missing: No such file or directory',
      'stack: at runShell (host.js:12)',
      'stack: at dispatch (host.js:40)',
      'stack: at main (host.js:90)',
    ].join('\n');
    const failedTool: ToolCardUi = {
      toolCallId: 'shell-error-stderr',
      toolName: 'bash',
      status: 'error',
      output: stderr,
      presentation: {
        title: 'Bash',
        kind: 'shell',
        actionVerb: 'Ran command',
        summary: 'ls /missing',
        command: 'ls /missing',
        error: { category: 'execution', message: 'Command failed: ls /missing' },
        output: { text: stderr },
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={failedTool} density="compact" locale="en" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.querySelector('[data-testid="tool-call-error"]')?.textContent).toContain(
      'Command failed: ls /missing',
    );
    expect(card?.querySelector('.tool-call-output')?.textContent).toContain(
      'No such file or directory',
    );
  });

  it('preserves a manual collapse while a running tool streams output', () => {
    const runningTool = createReadTool({
      toolCallId: 'read-streaming-1',
      status: 'running',
      output: 'first chunk',
    });

    act(() => {
      root.render(<ToolCallCard tool={runningTool} density="compact" locale="en" />);
    });
    const summary = container.querySelector<HTMLElement>('.tool-call-summary');
    expect(container.querySelector('.tool-call-card')?.classList.contains('is-expanded')).toBe(
      true,
    );

    act(() => summary?.click());
    expect(container.querySelector('.tool-call-card')?.classList.contains('is-expanded')).toBe(
      false,
    );

    act(() => {
      root.render(
        <ToolCallCard
          tool={{ ...runningTool, output: 'second chunk' }}
          density="compact"
          locale="en"
        />,
      );
    });
    expect(container.querySelector('.tool-call-card')?.classList.contains('is-expanded')).toBe(
      false,
    );
  });

  it('keeps a terminal failure visible but collapsed when owned by a call chain', () => {
    const failedTool = createReadTool({
      toolCallId: 'read-error-collapsed',
      status: 'error',
      output: 'Permission denied',
      presentation: {
        title: 'Read',
        kind: 'filesystem',
        actionVerb: 'Read',
        summary: 'private.txt',
        targetPaths: ['private.txt'],
        error: { category: 'permission', message: 'Permission denied' },
      },
    });

    act(() => {
      root.render(
        <ToolCallCard tool={failedTool} density="compact" collapseWhenTerminal locale="en" />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(card?.querySelector('[data-testid="tool-call-err"]')).not.toBeNull();
    expect(card?.querySelector('.tool-call-body')).toBeNull();
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
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Bash');
    expect(card?.querySelector('.tool-call-preview')).toBeNull();
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

  it('shows an inline diff when an edit row is expanded', async () => {
    const editTool: ToolCardUi = {
      toolCallId: 'edit-diff-1',
      toolName: 'replace_file_content',
      status: 'done',
      output: 'ok',
      presentation: {
        title: 'Edit',
        kind: 'filesystem',
        actionVerb: 'Edited',
        targetPaths: ['src/foo.ts'],
        changedPaths: ['src/foo.ts'],
      },
    };
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-file',
      success: true as const,
      data: {
        diff: {
          repository: { rootPath: '/workspace', isRepository: true },
          path: 'src/foo.ts',
          scope: 'combined' as const,
          isBinary: false,
          patch: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1,2 @@\n keep\n+added\n',
          truncated: false,
        },
      },
    }));

    act(() => {
      root.render(
        <ToolCallCard tool={editTool} projectPath="/workspace" request={request} locale="en" />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="diff-card"]')).not.toBeNull();

    // Clicking summary collapses the DiffCard
    act(() => {
      card?.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-testid="diff-card"]')).toBeNull();
  });

  it('never renders a DiffCard or review buttons when a write/edit tool errors', async () => {
    const errorTool: ToolCardUi = {
      toolCallId: 'write-err-1',
      toolName: 'write_file',
      status: 'error',
      output: 'Permission denied: Permission denied for write_file: piwin-config',
      presentation: {
        title: 'write_file',
        kind: 'filesystem',
        actionVerb: 'Edited',
        targetPaths: ['apps/desktop/src/file.tsx'],
        changedPaths: ['apps/desktop/src/file.tsx'],
        error: {
          category: 'permission',
          message: 'Permission denied for write_file: piwin-config',
        },
      },
    };
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-file',
      success: true as const,
      data: {
        diff: {
          repository: { rootPath: '/workspace', isRepository: true },
          path: 'apps/desktop/src/file.tsx',
          scope: 'combined' as const,
          isBinary: false,
          patch: '--- a/file.tsx\n+++ b/file.tsx\n@@ -1 +1,2 @@\n+change\n',
          truncated: false,
        },
      },
    }));

    act(() => {
      root.render(
        <ToolCallCard tool={errorTool} projectPath="/workspace" request={request} locale="zh-CN" />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    // Error cards auto-expand
    expect(card?.classList.contains('is-expanded')).toBe(true);
    // Must NOT render DiffCard
    expect(container.querySelector('[data-testid="diff-card"]')).toBeNull();
    expect(container.textContent).not.toContain('拒绝');
    expect(container.textContent).not.toContain('接受');
    // Request must not be called
    expect(request).not.toHaveBeenCalled();
    // Error message must be rendered
    expect(container.querySelector('[data-testid="tool-call-error"]')?.textContent).toContain(
      'permission: Permission denied for write_file: piwin-config',
    );
  });

  it('keeps a finished silent tool collapsed without a No output body', () => {
    const silent: ToolCardUi = {
      toolCallId: 'copy-1',
      toolName: 'bash',
      status: 'done',
      output: '',
      presentation: {
        title: 'Bash',
        kind: 'shell',
        actionVerb: 'Ran command',
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={silent} density="comfortable" locale="en" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('.tool-call-empty')).toBeNull();
    expect(container.textContent).not.toContain('No output');
  });

  it('keeps a silent tool collapsed and does not invent an empty-output body', () => {
    const silent: ToolCardUi = {
      toolCallId: 'copy-2',
      toolName: 'bash',
      status: 'done',
      output: '',
      presentation: {
        title: 'Bash',
        kind: 'shell',
        actionVerb: 'Ran command',
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={silent} density="comfortable" locale="zh-CN" />);
    });

    act(() => {
      container.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-testid="tool-call-empty-hint"]')).toBeNull();
    expect(container.textContent).not.toContain('无输出');
  });

  it('expands an edit file pill inline and opens full diff through diff-open-all button', async () => {
    const onOpenFile = vi.fn();
    const onOpenDiff = vi.fn();
    const editTool: ToolCardUi = {
      toolCallId: 'edit-pill-1',
      toolName: 'write_file',
      status: 'done',
      output: '',
      presentation: {
        title: 'Edit',
        kind: 'filesystem',
        actionVerb: 'Edited',
        targetPaths: ['src/foo.ts'],
        changedPaths: ['src/foo.ts'],
      },
    };
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-file',
      success: true as const,
      data: {
        diff: {
          repository: { rootPath: '/workspace', isRepository: true },
          path: 'src/foo.ts',
          scope: 'combined' as const,
          isBinary: false,
          patch: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1,2 @@\n keep\n+added\n',
          truncated: false,
        },
      },
    }));

    act(() => {
      root.render(
        <ToolCallCard
          tool={editTool}
          projectPath="/workspace"
          request={request}
          locale="en"
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
        />,
      );
    });

    // With canRenderDiffCard true, the edit tool is already auto-expanded
    expect(container.querySelector('[data-testid="tool-call-card"]')?.classList.contains('is-expanded')).toBe(
      true,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="diff-card"]')).not.toBeNull();

    // Clicking '全部差异 ↗' in the inline DiffCard header triggers onOpenDiff
    act(() => {
      container.querySelector<HTMLElement>('[data-testid="diff-open-all"]')?.click();
    });
    expect(onOpenDiff).toHaveBeenCalledWith('/workspace/src/foo.ts', 'src/foo.ts');

    // Clicking '打开' in the inline DiffCard header triggers onOpenFile
    act(() => {
      container.querySelector<HTMLElement>('[data-testid="diff-open-file"]')?.click();
    });
    expect(onOpenFile).toHaveBeenCalledWith('/workspace/src/foo.ts', 'src/foo.ts');
  });

  it('recovers a write path from inputPreview JSON so click can show a diff', async () => {
    const writeTool: ToolCardUi = {
      toolCallId: 'write-preview-1',
      toolName: 'write_file',
      status: 'done',
      output: '',
      presentation: {
        title: 'write_file',
        kind: 'filesystem',
        actionVerb: 'Edited',
        inputPreview: '{"path":"README.md","content":"# hi"}',
      },
    };
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-file',
      success: true as const,
      data: {
        diff: {
          repository: { rootPath: '/workspace', isRepository: true },
          path: 'README.md',
          scope: 'combined' as const,
          isBinary: false,
          patch: '--- a/README.md\n+++ b/README.md\n@@ -0,0 +1 @@\n+# hi\n',
          truncated: false,
        },
      },
    }));

    act(() => {
      root.render(
        <ToolCallCard tool={writeTool} projectPath="/workspace" request={request} locale="en" />,
      );
    });

    expect(container.querySelector('[data-testid="tool-call-file-pill"]')?.textContent).toContain(
      'README.md',
    );
    expect(container.querySelector('[data-testid="tool-call-diff-stats"]')?.textContent).toContain('+1');

    await act(async () => {
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="diff-card"]')).not.toBeNull();

    // Clicking summary collapses the DiffCard
    act(() => {
      container.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });
    expect(container.querySelector('[data-testid="tool-call-card"]')?.classList.contains('is-expanded')).toBe(false);
  });
});

describe('ToolCallCard shared six-state node vocabulary', () => {
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

  it('tags the status dot with the shared session-node-status kind for each outcome', () => {
    act(() => {
      root.render(<ToolCallCard tool={createReadTool({ status: 'done' })} density="compact" />);
    });
    expect(container.querySelector('[data-testid="tool-call-ok"]')?.getAttribute('data-kind')).toBe(
      'success',
    );

    act(() => {
      root.render(<ToolCallCard tool={createReadTool({ status: 'error' })} density="compact" />);
    });
    expect(
      container.querySelector('[data-testid="tool-call-err"]')?.getAttribute('data-kind'),
    ).toBe('failed');

    act(() => {
      root.render(<ToolCallCard tool={createReadTool({ status: 'running' })} density="compact" />);
    });
    expect(container.querySelector('.tool-status-dot')?.getAttribute('data-kind')).toBe('running');
  });

  it('renders proto-01 ink-line classes and an approved seal on write rows', () => {
    act(() => {
      root.render(
        <ToolCallCard
          tool={{
            toolCallId: 'w1',
            toolName: 'write_file',
            status: 'done',
            output: 'ok',
            presentation: {
              kind: 'filesystem',
              title: 'write_file',
              actionVerb: 'Edited',
              targetPaths: ['apps/desktop/src/composer-run-actions.tsx'],
            },
          }}
          density="compact"
        />,
      );
    });
    const card = container.querySelector('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('tr')).toBe(true);
    expect(container.querySelector('.node.done')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-approved-seal"]')?.textContent).toBe('允');
  });

  it('stamps write rows and leaves shell unmarked (proto-01)', () => {
    act(() => {
      root.render(
        <ToolCallCard
          tool={{
            toolCallId: 'b1',
            toolName: 'bash',
            status: 'done',
            output: 'ok',
            presentation: {
              kind: 'shell',
              title: 'bash',
              command: 'pnpm typecheck',
            },
          }}
          density="compact"
        />,
      );
    });
    expect(container.querySelector('[data-testid="tool-approved-seal"]')).toBeNull();

    act(() => {
      root.render(<ToolCallCard tool={createReadTool()} density="compact" />);
    });
    expect(container.querySelector('[data-testid="tool-approved-seal"]')).toBeNull();
  });

  it('shows the path on a collapsed row when Host provided targetPaths', () => {
    const tool: ToolCardUi = {
      toolCallId: 'patch-1',
      toolName: 'apply_workspace_patch',
      status: 'done',
      output: 'ok',
      presentation: {
        title: 'apply_workspace_patch',
        kind: 'other',
        targetPaths: ['apps/desktop/src/tool-call-card.tsx'],
      },
    };

    act(() => {
      root.render(<ToolCallCard tool={tool} density="compact" locale="zh-CN" />);
    });

    const pill = container.querySelector('[data-testid="tool-call-file-pill"]');
    expect(pill?.textContent).toContain('apps/desktop/src/tool-call-card.tsx');
    expect(container.querySelector('.tool-call-action-verb')?.textContent).not.toBe(
      'apply_workspace_patch',
    );
  });

  it('uses the Bash chip in Chinese locale instead of 命令', () => {
    act(() => {
      root.render(
        <ToolCallCard
          tool={{
            toolCallId: 'bash-zh-1',
            toolName: 'bash',
            status: 'done',
            output: 'ok',
            presentation: {
              title: 'Bash',
              kind: 'shell',
              actionVerb: 'Ran command',
              summary: 'pnpm typecheck',
              command: 'pnpm typecheck',
            },
          }}
          density="compact"
          locale="zh-CN"
        />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Bash');
    expect(card?.querySelector('.tool-call-preview')?.textContent).toContain('pnpm typecheck');
  });

  it('drops the command preview from the header once the row is expanded', () => {
    act(() => {
      root.render(
        <ToolCallCard
          tool={{
            toolCallId: 'bash-expand-1',
            toolName: 'bash',
            status: 'done',
            output: 'HTTP 200',
            presentation: {
              title: 'Bash',
              kind: 'shell',
              actionVerb: 'Ran command',
              summary:
                'cd /tmp && (nohup pnpm exec vite --port 1466 & ; sleep 6; curl -s http://127.0.0.1:1466)',
              command:
                'cd /tmp && (nohup pnpm exec vite --port 1466 & ; sleep 6; curl -s http://127.0.0.1:1466)',
              output: { text: 'HTTP 200' },
            },
          }}
          density="compact"
          locale="zh-CN"
        />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.classList.contains('is-expanded')).toBe(false);
    // Collapsed chip drops a leading `cd … &&` so the gray pill stays short.
    expect(card?.querySelector('.tool-call-preview')?.textContent).toContain('nohup pnpm exec vite');
    expect(card?.querySelector('.tool-call-preview')?.getAttribute('title')).toContain('cd /tmp');

    act(() => {
      card?.querySelector<HTMLElement>('.tool-call-summary')?.click();
    });

    expect(card?.classList.contains('is-expanded')).toBe(true);
    expect(card?.querySelector('.tool-call-preview')).toBeNull();
    expect(card?.querySelector('[data-testid="tool-call-command"]')?.textContent).toContain(
      'cd /tmp',
    );
  });

  it('drops the file pill from the header once a read row is expanded', () => {
    act(() => {
      root.render(<ToolCallCard tool={createReadTool()} density="compact" locale="zh-CN" />);
    });

    const card = container.querySelector<HTMLElement>('[data-testid="tool-call-card"]');
    expect(card?.querySelector('[data-testid="tool-call-file-pill"]')?.textContent).toContain(
      'pelican-bicycle-animation.html',
    );

    act(() => {
      card?.querySelector<HTMLElement>('[aria-label="Expand"]')?.click();
    });

    expect(card?.classList.contains('is-expanded')).toBe(true);
    expect(card?.querySelector('[data-testid="tool-call-file-pill"]')).toBeNull();
    expect(card?.querySelector('.tool-call-action-verb')?.textContent).toBe('Read');
  });
});

describe('collectSessionTools', () => {
  it('flattens tools from all messages in order', () => {
    const first: ToolCardUi = {
      toolCallId: 'a',
      toolName: 'bash',
      status: 'done',
      output: 'ok',
    };
    const second: ToolCardUi = {
      toolCallId: 'b',
      toolName: 'read',
      status: 'running',
      output: '',
    };
    const tools = collectSessionTools([
      { tools: [first] },
      { tools: [] },
      { tools: [second] },
    ]);
    expect(tools).toEqual([first, second]);
  });
});

describe('resolveToolOpenPath', () => {
  it('joins project-relative paths to the project root', () => {
    expect(resolveToolOpenPath('pelican-bicycle-animation.html', '/workspace')).toEqual({
      absolutePath: '/workspace/pelican-bicycle-animation.html',
      relativePath: 'pelican-bicycle-animation.html',
    });
  });

  it('keeps absolute paths and derives a project-relative path when under the root', () => {
    expect(
      resolveToolOpenPath('/workspace/apps/desktop/src/App.tsx', '/workspace'),
    ).toEqual({
      absolutePath: '/workspace/apps/desktop/src/App.tsx',
      relativePath: 'apps/desktop/src/App.tsx',
    });
  });

  it('returns the raw path when no project root is available', () => {
    expect(resolveToolOpenPath('src/App.tsx')).toEqual({
      absolutePath: 'src/App.tsx',
      relativePath: 'src/App.tsx',
    });
  });
});
