// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatusBar } from './status-bar.js';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('StatusBar Conversation chrome', () => {
  let container: HTMLElement;
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
  });

  function render(node: ReactElement): void {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

  it('hides skills and MCP while keeping model and context', () => {
    render(
      <StatusBar
        locale="en"
        modelLabel="gpt-test"
        skillsCount={4}
        mcpCount={2}
        contextPercent={33}
        isConversationSession
      />,
    );
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('gpt-test');
    expect(container.textContent).toContain('33%');
    expect(container.textContent).not.toContain('Skills');
    expect(container.textContent).not.toContain('MCP');
    expect(container.querySelector('.status-bar-chip')).toBeNull();
  });

  it('shows occupancy and last-turn details for Conversation usage', () => {
    render(
      <StatusBar
        locale="en"
        modelLabel="gpt-test"
        contextPercent={10}
        isConversationSession
        contextUsage={{
          sessionId: 'session-chat',
          tokensUsed: 12_400,
          tokensLimit: 128_000,
          promptTokens: 700,
          completionTokens: 200,
          source: 'host-estimate',
          updatedAt: '2026-08-16T00:00:00.000Z',
        }}
        modelContextWindow={128_000}
      />,
    );
    const trigger = container.querySelector('[data-testid="status-bar-context"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.textContent).toContain('12K / 128K');
    expect(trigger?.textContent).toContain('10%');
    act(() => {
      (trigger as HTMLButtonElement).click();
    });
    const details = document.querySelector('[data-testid="conversation-usage-details"]');
    expect(details?.textContent).toContain('Estimated');
    expect(details?.textContent).toContain('Input');
    expect(details?.textContent).toContain('Output');
    expect(details?.textContent).not.toContain('System prompt');
    expect(details?.textContent).not.toContain('Skills');
  });
});
