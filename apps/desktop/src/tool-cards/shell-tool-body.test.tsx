// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShellToolBody,
  classifyShellOutputLine,
  describeShellCommand,
  splitShellCommand,
} from './shell-tool-body';
import {
  ToolOutputMessageContext,
  ToolOutputReaderContext,
  type ToolOutputReader,
} from './tool-output-reader';

describe('splitShellCommand', () => {
  it('lifts a python heredoc body out of the shell text', () => {
    const segments = splitShellCommand("python3 << 'PY'\nimport re\nprint(1)\nPY\necho done");
    expect(segments).toEqual([
      { kind: 'shell', text: "python3 << 'PY'" },
      { kind: 'heredoc', text: 'import re\nprint(1)', lang: 'python', delimiter: 'PY' },
      { kind: 'shell', text: 'PY\necho done' },
    ]);
  });

  it('infers the heredoc language from a redirect target', () => {
    const [, body] = splitShellCommand('cat > notes.md <<EOF\n# Title\nEOF');
    expect(body).toMatchObject({ kind: 'heredoc', lang: 'markdown' });
  });

  it('leaves plain commands as a single shell segment', () => {
    expect(splitShellCommand('pnpm typecheck && pnpm test')).toEqual([
      { kind: 'shell', text: 'pnpm typecheck && pnpm test' },
    ]);
  });
});

describe('describeShellCommand', () => {
  it('names the heredoc language and counts every line', () => {
    expect(describeShellCommand("python3 << 'PY'\nprint(1)\nPY")).toEqual({
      lines: 3,
      heredocLang: 'python',
    });
    expect(describeShellCommand('pnpm install &&\npnpm test')).toEqual({ lines: 2 });
  });
});

describe('classifyShellOutputLine', () => {
  it('tints only marker lines', () => {
    expect(classifyShellOutputLine(' FAIL  src/a.test.ts')).toBe('err');
    expect(classifyShellOutputLine('AssertionError: expected 1')).toBe('err');
    expect(classifyShellOutputLine(' ✓ src/b.test.ts (3 tests)')).toBe('ok');
    expect(classifyShellOutputLine('warning: LF will be replaced')).toBe('warn');
    expect(classifyShellOutputLine('3cf4929e fix(desktop): error copy')).toBeNull();
  });
});

describe('ShellToolBody', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(props: Partial<Parameters<typeof ShellToolBody>[0]> = {}): void {
    act(() => {
      root.render(
        <ShellToolBody
          toolCallId="tc-1"
          command="pnpm vitest run"
          output={'\u001b[32m ✓ ok\u001b[39m\n FAIL  broken'}
          status="error"
          exitCode={1}
          error={undefined}
          truncation={undefined}
          truncationNotice={undefined}
          density="comfortable"
          locale="zh-CN"
          {...props}
        />,
      );
    });
  }

  it('stamps a non-zero exit and strips ANSI colour codes from output', () => {
    render();
    expect(container.querySelector('[data-testid="tool-call-shell-stamp"]')?.textContent).toBe(
      'exit 1',
    );
    expect(container.querySelector('.shell-trail-out')?.textContent).not.toContain('\u001b');
    expect(container.querySelector('[data-tone="err"]')?.textContent).toContain('FAIL');
  });

  it('names a timeout instead of an exit code and keeps the host message', () => {
    render({
      exitCode: null,
      output: '',
      error: { category: 'timeout', message: 'command timed out after 120s' },
    });
    expect(container.querySelector('[data-testid="tool-call-shell-stamp"]')?.textContent).toBe(
      '超时',
    );
    expect(container.querySelector('[data-testid="tool-call-error"]')?.textContent).toBe(
      'command timed out after 120s',
    );
    expect(container.querySelector('.shell-trail-out')).toBeNull();
  });

  it('folds long commands until asked', () => {
    const command = Array.from({ length: 30 }, (_, index) => `echo ${index}`).join('\n');
    render({ command, status: 'done', exitCode: 0 });
    const pane = container.querySelector('[data-testid="tool-call-command"]');
    expect(pane?.textContent).not.toContain('echo 29');
    act(() => {
      container.querySelector<HTMLButtonElement>('.shell-trail-more')?.click();
    });
    expect(pane?.textContent).toContain('echo 29');
  });

  it('reports the host line range when output was truncated', () => {
    render({
      status: 'done',
      exitCode: 0,
      truncation: { reason: 'line-limit', shownLines: { start: 1, end: 40 }, totalLines: 400 },
    });
    expect(container.querySelector('[data-testid="tool-call-output-notice"]')?.textContent).toBe(
      '仅显示 L1–L40 / 共 400 行',
    );
  });

  function renderWithReader(reader: ToolOutputReader): void {
    act(() => {
      root.render(
        <ToolOutputReaderContext.Provider value={reader}>
          <ToolOutputMessageContext.Provider value="msg-1">
            <ShellToolBody
              toolCallId="tc-1"
              command="ls -la"
              output=""
              status="done"
              exitCode={undefined}
              error={undefined}
              truncation={undefined}
              truncationNotice={undefined}
              density="comfortable"
              locale="zh-CN"
            />
          </ToolOutputMessageContext.Provider>
        </ToolOutputReaderContext.Provider>,
      );
    });
  }

  it('keeps a quiet success free of any stamp', () => {
    render({ status: 'done', exitCode: 0, output: 'ok' });
    expect(container.querySelector('[data-testid="tool-call-shell-stamp"]')).toBeNull();
    expect(container.querySelector('.shell-trail-foot')).toBeNull();
  });

  it('fetches slimmed historical output from the Host on expand', async () => {
    const reader = vi.fn<ToolOutputReader>(async () => ({
      status: 'ready',
      output: 'total 8\ndrwxr-xr-x  apps',
      truncated: false,
    }));
    renderWithReader(reader);
    expect(container.querySelector('[data-testid="tool-call-shell-loading"]')).not.toBeNull();
    await act(async () => {});
    expect(reader).toHaveBeenCalledWith('msg-1', 'tc-1');
    expect(container.querySelector('.shell-trail-out')?.textContent).toContain('drwxr-xr-x');
    expect(container.querySelector('[data-testid="tool-call-shell-empty"]')).toBeNull();
  });

  it('says 无输出 only when the Host confirms the output is empty', async () => {
    renderWithReader(async () => ({ status: 'empty' }));
    await act(async () => {});
    expect(container.querySelector('[data-testid="tool-call-shell-empty"]')?.textContent).toBe(
      '无输出',
    );
  });

  it('says nothing about output it could not read', async () => {
    renderWithReader(async () => ({ status: 'unavailable' }));
    await act(async () => {});
    expect(container.textContent).not.toContain('无输出');
    expect(container.querySelector('.shell-trail-foot')).toBeNull();
  });
});
