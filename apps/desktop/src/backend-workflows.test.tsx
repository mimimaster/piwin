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
});
