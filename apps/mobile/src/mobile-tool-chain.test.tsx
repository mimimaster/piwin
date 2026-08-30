// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MobileToolCallCard } from './components/chat/MobileToolCallCard.js';
import { MobileToolChain } from './components/chat/MobileToolChain.js';
import { MobileMessageItem } from './components/chat/MobileMessageItem.js';
import { MOBILE_THEME } from './mobile-theme.js';
import { handleRemotePush, type MobileTranscriptMessage } from './mobile-transcript.js';

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
            htmlUiModeEnabled
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

  it('shows an artifact card for a completed html fence', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileMessageItem
            htmlUiModeEnabled
            message={{
              id: 'msg-artifact',
              role: 'assistant',
              text: ['```artifact-html title="Landing"', '<section><h1>Hi</h1></section>', '```'].join(
                '\n',
              ),
              createdAt: '2026-08-16T12:00:00Z',
              status: 'done',
            }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('Landing');
    expect(container.textContent).not.toContain('<section><h1>Hi</h1></section>');
    expect(container.querySelector('[data-testid="mobile-artifact-stage"]')).not.toBeNull();
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('renders HealthToolCard from live tool/end presentation', () => {
    let messages: MobileTranscriptMessage[] = [];
    const setMessages = (
      update: MobileTranscriptMessage[] | ((current: MobileTranscriptMessage[]) => MobileTranscriptMessage[]),
    ) => {
      messages = typeof update === 'function' ? update(messages) : update;
    };
    const activeSessionRef = { current: 'session-1' };
    const noop = () => undefined;
    handleRemotePush(
      {
        type: 'event',
        sessionId: 'session-1',
        event: { type: 'message/start', messageId: 'msg-h', role: 'assistant' },
      },
      activeSessionRef,
      setMessages,
      noop,
      noop,
    );
    handleRemotePush(
      {
        type: 'event',
        sessionId: 'session-1',
        event: {
          type: 'tool/start',
          toolCallId: 'health-1',
          toolName: 'health_read_context',
          responseMessageId: 'msg-h',
          presentation: {
            kind: 'health',
            title: '读取 Apple Health',
            health: {
              metrics: ['steps'],
              periodLabel: '今天',
              status: 'waiting-for-phone',
            },
          },
        },
      },
      activeSessionRef,
      setMessages,
      noop,
      noop,
    );
    handleRemotePush(
      {
        type: 'event',
        sessionId: 'session-1',
        event: {
          type: 'tool/end',
          toolCallId: 'health-1',
          isError: false,
          responseMessageId: 'msg-h',
          presentation: {
            kind: 'health',
            title: '读取 Apple Health',
            health: {
              metrics: ['steps'],
              periodLabel: '今天',
              status: 'completed',
              freshnessLabel: '08:42',
            },
          },
        },
      },
      activeSessionRef,
      setMessages,
      noop,
      noop,
    );
    const tool = messages[0]?.toolCalls?.[0];
    expect(tool?.presentation?.kind).toBe('health');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileToolCallCard tool={tool!} />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="health-tool-card"]')).not.toBeNull();
    expect(container.textContent).toContain('已完成');
    expect(container.textContent).not.toContain('schemaVersion');
  });

  it('capability off: completed html fence stays source-only', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileMessageItem
            htmlUiModeEnabled={false}
            message={{
              id: 'msg-artifact-off',
              role: 'assistant',
              text: ['```artifact-html title="Landing"', '<section><h1>Hi</h1></section>', '```'].join(
                '\n',
              ),
              createdAt: '2026-08-16T12:00:00Z',
              status: 'done',
            }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.artifact-preview-btn')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('keeps flashcard text and offers 进入复习台', () => {
    const onEnter = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <MobileToolCallCard
            defaultExpanded
            onEnterFlashcardStudy={onEnter}
            tool={{
              id: 'fc-1',
              name: 'flashcard_create',
              status: 'done',
              presentation: {
                kind: 'other',
                title: '闪卡',
                flashcard: {
                  cards: [
                    {
                      cardId: 'card-1',
                      itemId: 'item-1',
                      model: 'basic',
                      ordinal: 1,
                      deck: 'srs',
                      front: 'What is an Artifact?',
                      back: 'Untrusted HTML rendered in a sandbox.',
                      createdAt: '2026-08-24T00:00:00.000Z',
                    },
                  ],
                },
              },
            }}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('Q: What is an Artifact?');
    const enter = container.querySelector<HTMLButtonElement>(
      '[data-testid="mobile-enter-flashcard-study"]',
    );
    expect(enter?.textContent).toContain('进入复习台');
    act(() => {
      enter?.click();
    });
    expect(onEnter).toHaveBeenCalled();
  });
});
