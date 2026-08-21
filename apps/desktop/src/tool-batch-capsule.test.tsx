// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ToolCardUi } from './chat-reducer';
import { ToolBatchCapsule } from './tool-batch-capsule';
import { computeBatchSummary } from './tool-group-clustering';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeSearchTool(id: string, query: string, overrides?: Partial<ToolCardUi>): ToolCardUi {
  return {
    toolCallId: id,
    toolName: 'grep_search',
    status: 'done',
    output: 'match found',
    presentation: {
      kind: 'filesystem',
      title: 'Search',
      actionVerb: 'Searched',
      summary: query,
      durationMs: 120,
    },
    ...overrides,
  };
}

function makeReadTool(id: string, path: string, overrides?: Partial<ToolCardUi>): ToolCardUi {
  return {
    toolCallId: id,
    toolName: 'view_file',
    status: 'done',
    output: 'file content',
    presentation: {
      kind: 'filesystem',
      title: 'Read',
      actionVerb: 'Read',
      targetPaths: [path],
      durationMs: 80,
    },
    ...overrides,
  };
}

describe('ToolBatchCapsule', () => {
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

  it('renders collapsed capsule by default with summary counts and targets', () => {
    const tools = [
      makeSearchTool('t1', 'Configured model'),
      makeSearchTool('t2', 'model is unavailable'),
      makeSearchTool('t3', 'getModel'),
    ];
    const summary = computeBatchSummary('search', tools);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ToolBatchCapsule
            clusterKind="search"
            tools={tools}
            summary={summary}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    const capsule = container.querySelector('[data-testid="tool-batch-capsule"]');
    expect(capsule).not.toBeNull();
    expect(capsule?.getAttribute('data-expanded')).toBe('false');
    expect(container.textContent).toContain('检索了 3 处代码');
    expect(container.querySelector('[data-testid="tool-batch-body"]')).toBeNull();
  });

  it('renders unified exploration summary with files and searches counts in Cursor style', () => {
    const tools = [
      makeReadTool('r1', '/src/host.ts'),
      makeReadTool('r2', '/src/use-host.ts'),
      makeSearchTool('s1', 'createRemoteProjectId'),
      makeSearchTool('s2', 'getPiwinRoot'),
    ];
    const summary = computeBatchSummary('explore', tools);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ToolBatchCapsule
            clusterKind="explore"
            tools={tools}
            summary={summary}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Explored 2 files · 2 searches');
  });

  it('displays running exploration title and active action marquee when a tool is running', () => {
    const tools = [
      makeReadTool('r1', '/src/host.ts'),
      makeSearchTool('s1', 'createRemoteProjectId', { status: 'running' }),
    ];
    const summary = computeBatchSummary('explore', tools);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ToolBatchCapsule
            clusterKind="explore"
            tools={tools}
            summary={summary}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const marquee = container.querySelector('[data-testid="action-marquee"]');
    expect(marquee).not.toBeNull();
    expect(container.textContent).toContain('Exploring codebase');
    expect(marquee?.textContent).toContain('Searching createRemoteProjectId');
  });

  it('expands children on header click and collapses on second click', () => {
    const tools = [
      makeSearchTool('t1', 'Configured model'),
      makeSearchTool('t2', 'model is unavailable'),
    ];
    const summary = computeBatchSummary('search', tools);

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ToolBatchCapsule
            clusterKind="search"
            tools={tools}
            summary={summary}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const header = container.querySelector<HTMLButtonElement>('[data-testid="tool-batch-header"]');
    expect(header).not.toBeNull();

    // 1st click -> Expand
    act(() => header?.click());
    expect(container.querySelector('[data-testid="tool-batch-body"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);

    // 2nd click -> Collapse
    act(() => header?.click());
    expect(container.querySelector('[data-testid="tool-batch-body"]')).toBeNull();
  });
});
