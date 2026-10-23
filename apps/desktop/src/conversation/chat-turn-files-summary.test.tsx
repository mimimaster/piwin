// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import { ChatTurnFilesSummary } from './chat-turn-files-summary';

const changedFileTools: ToolCardUi[] = [
  {
    toolCallId: 'c1',
    toolName: 'write_file',
    status: 'done',
    output: '',
    presentation: {
      kind: 'filesystem',
      title: 'write_file',
      targetPaths: ['/workspace/docs/example.md'],
    },
  },
];

function renderSummary(element: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe('ChatTurnFilesSummary mount', () => {
  it('does not render FilesChangedBar for conversation sessions', () => {
    const { container, root } = renderSummary(
      (
        <ChatTurnFilesSummary
          isConversationSession
          role="assistant"
          tools={changedFileTools}
          locale="zh-CN"
        />
      ) as ReactElement,
    );

    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();
    cleanup(root, container);
  });

  it('does not render FilesChangedBar for user messages', () => {
    const { container, root } = renderSummary(
      (
        <ChatTurnFilesSummary role="user" tools={changedFileTools} locale="zh-CN" />
      ) as ReactElement,
    );

    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();
    cleanup(root, container);
  });

  it('does not render FilesChangedBar when assistant tools are empty', () => {
    const { container, root } = renderSummary(
      (<ChatTurnFilesSummary role="assistant" tools={[]} locale="zh-CN" />) as ReactElement,
    );

    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();
    cleanup(root, container);
  });

  it('does not render FilesChangedBar while the turn is still running', () => {
    const { container, root } = renderSummary(
      (
        <ChatTurnFilesSummary
          role="assistant"
          turnInProgress
          tools={changedFileTools}
          projectPath="/workspace"
          locale="zh-CN"
        />
      ) as ReactElement,
    );

    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();
    cleanup(root, container);
  });

  it('renders FilesChangedBar for assistant messages with tools', () => {
    const { container, root } = renderSummary(
      (
        <ChatTurnFilesSummary
          role="assistant"
          tools={changedFileTools}
          projectPath="/workspace"
          locale="zh-CN"
        />
      ) as ReactElement,
    );

    expect(container.querySelector('[data-testid="files-changed-bar"]')).not.toBeNull();
    expect(container.textContent).toContain('1 个文件已更改');
    cleanup(root, container);
  });
});
