import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ForkSessionOrigin } from '@piwin/contracts';
import { StageHeader } from './stage-header.js';
import type { RunStatusView } from './run-status.js';

const mockWorkingRun: RunStatusView = {
  kind: 'working',
  label: 'Working…',
  summary: 'Working…',
  canStop: true,
  completedToolCount: 0,
  runningJobCount: 0,
};

const mockWaitingRun: RunStatusView = {
  kind: 'waiting-permission',
  label: 'Waiting for permission',
  summary: 'Waiting for permission',
  canStop: true,
  completedToolCount: 0,
  runningJobCount: 0,
};

const mockForkOrigin: ForkSessionOrigin = {
  kind: 'fork',
  rootSessionId: 'root-1',
  sourceSessionId: 'src-1',
  sourceSessionNameSnapshot: 'Parent Session',
  sourceMessageId: 'msg-1',
  sourceMessageRole: 'assistant',
  sourceMessagePreview: 'preview',
  sourceMessageCreatedAt: '2026-09-06T00:00:00Z',
  createdAt: '2026-09-06T00:00:00Z',
  workspaceStrategy: 'shared',
};

describe('StageHeader', () => {
  it('renders session title and fork button when idle', () => {
    const markup = renderToStaticMarkup(
      <StageHeader title="Composer 忙会话队列" />,
    );

    expect(markup).toContain('Composer 忙会话队列');
    expect(markup).toContain('data-testid="stage-header"');
    expect(markup).toContain('data-state="idle"');
    expect(markup).not.toContain('class="lamp"');
    expect(markup).not.toContain('class="sq"');
  });

  it('renders lamp dot when state is running', () => {
    const markup = renderToStaticMarkup(
      <StageHeader
        title="Running Session"
        runState={mockWorkingRun}
      />,
    );

    expect(markup).toContain('data-state="running"');
    expect(markup).toContain('class="lamp"');
    expect(markup).not.toContain('class="sq"');
  });

  it('renders sq dot when state is waiting for permission', () => {
    const markup = renderToStaticMarkup(
      <StageHeader
        title="Waiting Session"
        runState={mockWaitingRun}
      />,
    );

    expect(markup).toContain('data-state="waiting"');
    expect(markup).toContain('class="sq"');
    expect(markup).not.toContain('class="lamp"');
  });

  it('renders permission mode badge and origin badge', () => {
    const markup = renderToStaticMarkup(
      <StageHeader
        title="Branched Session"
        permissionMode="yolo"
        origin={mockForkOrigin}
      />,
    );

    expect(markup).toContain('data-testid="stage-mode-badge"');
    expect(markup).toContain('YOLO');
    expect(markup).toContain('data-testid="stage-origin-badge"');
    expect(markup).toContain('分支');
  });

  it('renders trailing project/branch chrome on the right', () => {
    const markup = renderToStaticMarkup(
      <StageHeader
        title="Project Session"
        trailing={<span data-testid="fake-chips">piwin · main</span>}
      />,
    );

    expect(markup).toContain('data-testid="stage-header-trailing"');
    expect(markup).toContain('data-testid="fake-chips"');
    expect(markup).toContain('piwin · main');
  });
});
