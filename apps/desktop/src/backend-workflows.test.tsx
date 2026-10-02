// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { BackendWorkflows } from './backend-workflows.js';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('BackendWorkflows', () => {
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

  it('renders workflows container on the timeline sequence', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      success: true,
      data: {
        sessionId: 'session-1',
        workflows: [
          {
            workflowId: 'wf-1',
            sessionId: 'session-1',
            agentId: 'grok',
            name: 'deep-research',
            objective: '调研量子算法',
            status: 'running',
            revision: 1,
            phases: [],
            agents: [],
            history: [],
            reportAvailable: false,
          },
        ],
      },
    });

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflows sessionId="session-1" request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const sequence = container.querySelector('[data-testid="backend-workflows-sequence"]');
    expect(sequence).not.toBeNull();
    expect(sequence?.className).toContain('turn-tool-sequence');
    expect(container.textContent).toContain('deep-research');
  });

  it('returns null when no active workflows exist', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      success: true,
      data: {
        sessionId: 'session-1',
        workflows: [],
      },
    });

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflows sessionId="session-1" request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    const sequence = container.querySelector('[data-testid="backend-workflows-sequence"]');
    expect(sequence).toBeNull();
  });

  it('does not paint a missing workflow method as a chat error', async () => {
    const mockRequest = vi.fn().mockResolvedValue({
      success: false,
      error: 'session2.listWorkflows is not a function',
    });

    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <BackendWorkflows sessionId="session-1" request={mockRequest} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    expect(mockRequest).toHaveBeenCalled();
    expect(container.textContent).not.toContain('is not a function');
    expect(container.querySelector('[data-testid="backend-workflows-sequence"]')).toBeNull();
  });
  it('keeps polling after foreground completion and preserves progress through a read failure', async () => {
    vi.useFakeTimers();
    const snapshot = { workflowId: 'wf_1', sessionId: 'session-1', agentId: 'grok', name: 'deep-research', objective: 'topic',
      status: 'active', revision: 1, phases: [{ title: 'Plan', status: 'active' }], agents: [], history: [], reportAvailable: false };
    const request = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { sessionId: 'session-1', workflows: [snapshot] } })
      .mockResolvedValueOnce({ success: false, error: 'temporarily unavailable' })
      .mockResolvedValue({ success: true, data: { sessionId: 'session-1', workflows: [{ ...snapshot, status: 'completed', revision: 2 }] } });
    try {
      await act(async () => root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <BackendWorkflows sessionId="session-1" request={request} locale="zh-CN" />
      </PiwinUiProvider>));
      expect(container.textContent).toContain('运行中');
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(container.textContent).toContain('deep-research');
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(container.textContent).toContain('已完成');
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(request).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });

  it('does not paint a late response from the previous session after navigation', async () => {
    let finish: ((result: unknown) => void) | undefined;
    const request = vi.fn().mockImplementation((command) => command.sessionId === 'old'
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ success: true, data: { sessionId: 'new', workflows: [] } }));
    const render = (sessionId: string) => act(async () => root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <BackendWorkflows sessionId={sessionId} request={request} locale="zh-CN" />
    </PiwinUiProvider>));
    await render('old'); await render('new');
    await act(async () => finish?.({ success: true, data: { sessionId: 'old', workflows: [{ workflowId: 'wf_old', sessionId: 'old',
      agentId: 'grok', name: 'old-research', objective: '', status: 'active', revision: 1, phases: [], agents: [], history: [], reportAvailable: false }] } }));
    expect(container.textContent).not.toContain('old-research');
  });

});
