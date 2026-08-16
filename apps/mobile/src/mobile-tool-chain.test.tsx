// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileToolCallCard } from './components/chat/MobileToolCallCard.js';
import { MobileToolChain } from './components/chat/MobileToolChain.js';
import { MobileMessageItem } from './components/chat/MobileMessageItem.js';
import { MOBILE_THEME } from './mobile-theme.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('Mobile Tool Call Chain & Execution Cards', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders single MobileToolCallCard with verb, duration, and expandable terminal output', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileToolCallCard
            tool={{
              id: 'call-1',
              name: 'run_command',
              status: 'done',
              actionVerb: '执行命令',
              command: 'pnpm test',
              output: 'Tests passed: 12/12',
              durationMs: 450,
            }}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('执行命令');
    expect(container.textContent).toContain('pnpm test');
    expect(container.textContent).toContain('450ms');

    const summaryBtn = container.querySelector('.mobile-tool-summary-btn') as HTMLButtonElement;
    expect(summaryBtn).not.toBeNull();

    // Click to expand terminal output
    act(() => {
      summaryBtn.click();
    });

    expect(container.textContent).toContain('执行输出');
    expect(container.textContent).toContain('Tests passed: 12/12');
  });

  it('renders batch MobileToolChain with count badge and collapsible tool list', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileToolChain
            tools={[
              {
                id: 't1',
                name: 'read_file',
                status: 'done',
                actionVerb: '读取文件',
                targetPaths: ['src/index.ts'],
                durationMs: 40,
              },
              {
                id: 't2',
                name: 'write_file',
                status: 'done',
                actionVerb: '编辑文件',
                targetPaths: ['src/index.ts'],
                durationMs: 80,
              },
            ]}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('工具调用链');
    expect(container.textContent).toContain('2 项操作');
    expect(container.textContent).toContain('2 项已完成');
    expect(container.textContent).toContain('读取文件');
    expect(container.textContent).toContain('编辑文件');
  });

  it('renders message item with causal order: thinking -> tool chain -> assistant text', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileMessageItem
            message={{
              id: 'msg-causal',
              role: 'assistant',
              text: '任务已顺利完成。',
              thinking: '首先读取配置，然后执行单元测试。',
              toolCalls: [
                {
                  id: 'c1',
                  name: 'run_command',
                  status: 'done',
                  actionVerb: '执行命令',
                  command: 'pnpm test',
                  durationMs: 320,
                },
              ],
              createdAt: '2026-08-16T12:00:00Z',
              status: 'done',
            }}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Piwin Agent');
    expect(container.textContent).toContain('思考过程');
    expect(container.textContent).toContain('执行命令');
    expect(container.textContent).toContain('任务已顺利完成。');
  });
});
