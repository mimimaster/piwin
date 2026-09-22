// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ChatMessageUi, PermissionPromptUi, SubagentStreamState, ToolCardUi } from './chat-reducer';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentSessionTranscript } from './subagent-session-transcript';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const historicalMessages: ChatMessageUi[] = [
  {
    id: 'child-message-1',
    role: 'assistant',
    text: 'The child agent completed its task.',
    thinking: 'Inspecting the child session history.',
    tools: [],
    attachments: [],
    status: 'done',
  },
];

const liveStream: SubagentStreamState = {
  childSessionId: 'child-session-1',
  completedSegments: [],
  completionRevision: 0,
  text: 'The child agent is preparing the next step.',
  thinking: 'Reviewing the live child session state.',
  tools: [],
  streaming: true,
  currentMessageId: 'child-message-2',
};

function renderTranscript(input: { root: Root; showThinking: boolean }): void {
  input.root.render(
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SubagentSessionTranscript
        historicalMessages={historicalMessages}
        stream={liveStream}
        loading={false}
        error={null}
        onRetry={() => undefined}
        locale="en"
        artifactInlineEnabled={true}
        showThinking={input.showThinking}
      />
    </PiwinUiProvider>,
  );
}

describe('SubagentSessionTranscript thinking visibility', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => {
        mountedRoot.root.unmount();
      });
      mountedRoot.container.remove();
    }
  });

  it('hides persisted and live thinking without hiding child output', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      renderTranscript({ root, showThinking: false });
    });

    expect(container.querySelectorAll('.turn-thinking')).toHaveLength(0);
    expect(container.textContent).toContain(historicalMessages[0]?.text);
    expect(container.textContent).toContain(liveStream.text);

    act(() => {
      renderTranscript({ root, showThinking: true });
    });

    expect(container.querySelectorAll('.turn-thinking')).toHaveLength(2);
    expect(container.textContent).toContain(historicalMessages[0]?.thinking);
    expect(container.textContent).toContain(liveStream.thinking);
  });

  it('uses the standard tool-call renderer for live child work', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentSessionTranscript
            historicalMessages={[]}
            stream={{
              ...liveStream,
              thinking: '',
              tools: [
                {
                  toolCallId: 'child-tool-1',
                  toolName: 'bash',
                  status: 'running',
                  output: 'running tests',
                  presentation: {
                    kind: 'shell',
                    title: 'Bash',
                    actionVerb: 'Ran command',
                    command: 'pnpm test',
                    output: { text: 'running tests' },
                  },
                },
              ],
            }}
            loading={false}
            error={null}
            onRetry={() => undefined}
            locale="en"
            artifactInlineEnabled={true}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
    expect(container.textContent).toContain('pnpm test');
  });
});

function readFileTool(id: string, relativePath: string): ToolCardUi {
  return {
    toolCallId: id,
    toolName: 'read',
    status: 'done',
    output: 'ok',
    presentation: {
      kind: 'filesystem',
      title: 'Read',
      actionVerb: 'Read',
      targetPaths: [relativePath],
    },
  };
}

const thinkingOnlyExploreMessage: ChatMessageUi = {
  id: 'child-thinking-only',
  role: 'assistant',
  text: '',
  thinking: 'Checking the contracts before editing.',
  thinkingStartedAt: 1_000,
  thinkingEndedAt: 5_000,
  tools: [
    readFileTool('read-1', 'packages/contracts/src/ipc.ts'),
    readFileTool('read-2', 'packages/contracts/src/remote-protocol.ts'),
  ],
  attachments: [],
  status: 'done',
};

describe('SubagentSessionTranscript work-details layout', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => {
        mountedRoot.root.unmount();
      });
      mountedRoot.container.remove();
    }
  });

  it('cancels transcript auto-margins so inspector work chrome shares the left edge', async () => {
    const css = await readFile(path.join(SRC_DIR, 'styles/subagent-session-inspector.css'), 'utf8');
    const rule =
      /\.subagent-inspector-message\.role-assistant\s+\.turn-work-details\s*\{([^}]+)\}/s.exec(
        css,
      )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/width:\s*100%/);
    expect(rule).toMatch(/max-width:\s*100%/);
    expect(rule).toMatch(/margin-left:\s*0/);
    expect(rule).toMatch(/margin-right:\s*0/);
    expect(rule).toMatch(/align-self:\s*stretch/);
  });

  it('nests thinking-only explore chrome under the inspector assistant message', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentSessionTranscript
            historicalMessages={[thinkingOnlyExploreMessage]}
            stream={null}
            loading={false}
            error={null}
            onRetry={() => undefined}
            locale="zh-CN"
            artifactInlineEnabled={true}
          />
        </PiwinUiProvider>,
      );
    });

    const message = container.querySelector('.subagent-inspector-message.role-assistant');
    const workDetails = message?.querySelector('[data-testid="turn-work-details"]');
    expect(message).not.toBeNull();
    expect(workDetails).not.toBeNull();
    expect(workDetails?.parentElement).toBe(message);
    expect(container.textContent).toContain('思考过程');
    expect(container.querySelector('[data-testid="work-fold-elapsed"]')?.textContent).toBe('4s');
    expect(container.textContent).not.toContain('已思考 4 秒');
    expect(container.textContent).toContain('探索了 2 个文件');
    expect(container.querySelector('[data-testid="tool-batch-capsule"]')).not.toBeNull();
    expect(container.querySelector('.markdown')).toBeNull();
  });
});

describe('SubagentSessionTranscript jump-to-latest', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => {
        mountedRoot.root.unmount();
      });
      mountedRoot.container.remove();
    }
  });

  it('reuses the shared arrow chrome instead of a labeled pill', async () => {
    const css = await readFile(path.join(SRC_DIR, 'styles/subagent-session-inspector.css'), 'utf8');
    expect(css).not.toContain('.subagent-inspector-jump-latest');
    const viewportRule = /\.subagent-inspector-viewport\s*\{([^}]+)\}/s.exec(css)?.[1];
    expect(viewportRule).toBeDefined();
    expect(viewportRule).toMatch(/position:\s*relative/);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      renderTranscript({ root, showThinking: false });
    });

    const scroll = container.querySelector<HTMLDivElement>('.subagent-inspector-scroll');
    expect(scroll).not.toBeNull();
    if (scroll === null) {
      throw new Error('Expected the subagent preview scrollport');
    }
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 800 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(scroll, 'scrollTop', { configurable: true, writable: true, value: 0 });

    act(() => {
      scroll.dispatchEvent(new Event('scroll'));
    });

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="subagent-inspector-jump-latest"]',
    );
    expect(button).not.toBeNull();
    expect(button?.className).toBe('jump-to-latest-btn');
    expect(button?.getAttribute('aria-label')).toBe('Back to latest');
    expect(button?.textContent?.trim()).toBe('');
    expect(button?.querySelector('svg')).not.toBeNull();
    expect(button?.parentElement?.className).toBe('subagent-inspector-viewport');

    act(() => {
      button?.click();
    });
    expect(scroll.scrollTop).toBe(800);
    expect(container.querySelector('[data-testid="subagent-inspector-jump-latest"]')).toBeNull();
  });

  it('pins a live permission request below the scrollport', () => {
    const prompt: PermissionPromptUi = {
      requestId: 'child-perm',
      sessionId: 'child-session-1',
      action: 'bash',
      detail: 'rm -rf build',
      defaultDecision: 'ask',
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentSessionTranscript
            historicalMessages={historicalMessages}
            stream={{ ...liveStream, permissionPrompt: prompt }}
            loading={false}
            error={null}
            onRetry={() => undefined}
            locale="en"
            artifactInlineEnabled={true}
            showThinking={false}
            onPermission={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });

    const bar = container.querySelector('[data-testid="permission-bar"]');
    const scroll = container.querySelector('.subagent-inspector-scroll');
    expect(bar).not.toBeNull();
    expect(scroll?.contains(bar ?? null)).toBe(false);
    expect(bar?.parentElement?.className).toBe('subagent-inspector-viewport');
  });
});
