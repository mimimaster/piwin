// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ToolCardUi } from './chat-reducer';
import type { ExploreFlowGroup } from './explore-flow';
import { ExploreFlowCapsule } from './explore-flow-capsule';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function readTool(toolCallId: string, path: string, status: ToolCardUi['status'] = 'done'): ToolCardUi {
  return {
    toolCallId,
    toolName: 'read',
    status,
    output: 'body',
    presentation: {
      kind: 'filesystem',
      title: 'Read',
      actionVerb: 'Read',
      targetPaths: [path],
    },
  };
}

function doneGroup(): ExploreFlowGroup {
  return {
    anchorMessageId: 'm1',
    memberMessageIds: ['m1', 'm2'],
    items: [
      { kind: 'thought', messageId: 'm1', text: 'inspect the reducer first', seconds: 2 },
      { kind: 'tool', messageId: 'm1', tool: readTool('t1', 'src/a.ts') },
      { kind: 'tool', messageId: 'm2', tool: readTool('t2', 'src/b.ts') },
    ],
    toolCount: 2,
    fileCount: 2,
    searchCount: 0,
    thoughtCount: 1,
    hasRunning: false,
    isLive: false,
    errorCount: 0,
    cancelledCount: 0,
    totalDurationMs: 40,
  };
}

describe('ExploreFlowCapsule', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(group: ExploreFlowGroup, locale: 'zh-CN' | 'en' = 'zh-CN'): void {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ExploreFlowCapsule group={group} locale={locale} />
      </PiwinUiProvider>,
    );
  }

  it('renders a collapsed summary for a settled flow and expands on click', () => {
    act(() => render(doneGroup()));

    const capsule = container.querySelector('[data-testid="explore-flow-capsule"]');
    expect(capsule?.getAttribute('data-expanded')).toBe('false');
    expect(container.textContent).toContain('探索了 2 个文件');
    expect(container.querySelector('[data-testid="explore-flow-body"]')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="explore-flow-header"]')
        ?.click();
    });
    expect(capsule?.getAttribute('data-expanded')).toBe('true');
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);
    expect(container.textContent).toContain('思考过程');
    expect(
      container.querySelector(
        '[data-testid="explore-thought-row"] [data-testid="work-fold-elapsed"]',
      )?.textContent,
    ).toBe('2s');
    expect(container.textContent).not.toContain('已思考 2 秒');
  });

  it('expands the thought text when its row is clicked', () => {
    act(() => render(doneGroup()));
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="explore-flow-header"]')
        ?.click();
    });
    expect(container.querySelector('[data-testid="explore-thought-body"]')).toBeNull();

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="explore-thought-row"]')
        ?.click();
    });
    expect(
      container.querySelector('[data-testid="explore-thought-body"]')?.textContent,
    ).toContain('inspect the reducer first');
  });

  it('stays collapsed while live and only auto-opens when a grouped tool fails', () => {
    const liveGroup: ExploreFlowGroup = {
      ...doneGroup(),
      items: [
        { kind: 'tool', messageId: 'm1', tool: readTool('t1', 'src/a.ts') },
        { kind: 'tool', messageId: 'm2', tool: readTool('t2', 'src/b.ts', 'running') },
      ],
      thoughtCount: 0,
      hasRunning: true,
      isLive: true,
    };
    act(() => render(liveGroup));

    const capsule = container.querySelector('[data-testid="explore-flow-capsule"]');
    expect(capsule?.getAttribute('data-expanded')).toBe('false');
    expect(capsule?.getAttribute('data-live')).toBe('true');
    expect(container.textContent).toContain('正在探索代码库');
    expect(container.querySelector('[data-testid="explore-flow-body"]')).toBeNull();

    act(() => render(doneGroup()));
    expect(
      container
        .querySelector('[data-testid="explore-flow-capsule"]')
        ?.getAttribute('data-expanded'),
    ).toBe('false');
    expect(container.textContent).toContain('探索了 2 个文件');

    act(() =>
      render({
        ...doneGroup(),
        errorCount: 1,
      }),
    );
    expect(
      container
        .querySelector('[data-testid="explore-flow-capsule"]')
        ?.getAttribute('data-expanded'),
    ).toBe('true');
  });

  it('keeps already-emitted tool cards mounted when a live group grows', () => {
    const firstTool = readTool('t1', 'src/a.ts');
    const secondTool = readTool('t2', 'src/b.ts');
    const liveTwo: ExploreFlowGroup = {
      ...doneGroup(),
      items: [
        { kind: 'tool', messageId: 'm1', tool: firstTool },
        { kind: 'tool', messageId: 'm2', tool: secondTool },
      ],
      thoughtCount: 0,
      toolCount: 2,
      hasRunning: true,
      isLive: true,
    };
    act(() => render(liveTwo));
    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="explore-flow-header"]')
        ?.click();
    });
    const firstCard = container.querySelector('[data-testid="tool-call-card"]');
    expect(firstCard).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);

    const liveThree: ExploreFlowGroup = {
      ...liveTwo,
      items: [
        ...liveTwo.items,
        { kind: 'tool', messageId: 'm3', tool: readTool('t3', 'src/c.ts', 'running') },
      ],
      toolCount: 3,
      fileCount: 3,
    };
    act(() => render(liveThree));

    expect(container.querySelector('[data-testid="tool-call-card"]')).toBe(firstCard);
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(3);
    expect(
      container
        .querySelector('[data-testid="explore-flow-capsule"]')
        ?.getAttribute('data-expanded'),
    ).toBe('true');
  });

  it('keeps a cancelled explore chain collapsed without a red failure icon', () => {
    act(() =>
      render({
        ...doneGroup(),
        cancelledCount: 2,
        errorCount: 0,
      }),
    );
    const capsule = container.querySelector('[data-testid="explore-flow-capsule"]');
    expect(capsule?.getAttribute('data-expanded')).toBe('false');
    expect(capsule?.className).not.toContain('has-error');
    expect(container.textContent).toContain('已停止');
    expect(container.querySelector('.tool-batch-error-icon')).toBeNull();
    expect(container.querySelector('[data-testid="explore-flow-body"]')).toBeNull();
  });
});
