// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { GateCard } from './gate-card';
import type { PermissionPromptUi } from './chat-reducer';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const basePrompt: PermissionPromptUi = {
  requestId: 'req-1',
  sessionId: 's1',
  action: 'bash:ls -la',
  detail: 'ls -la',
  defaultDecision: 'ask',
};

function Harness(props: {
  prompt: PermissionPromptUi;
  projectPath: string | null;
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
}): ReactElement {
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <GateCard
        prompt={props.prompt}
        projectPath={props.projectPath}
        onPermission={props.onPermission}
      />
    </PiwinUiProvider>
  );
}

describe('GateCard', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
  });

  it('renders the gate with action label and default-decision hint', () => {
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={vi.fn()} />),
    );
    const gate = container.querySelector('[data-testid="permission-gate"]');
    expect(gate).not.toBeNull();
    expect(container.textContent).toContain('需要审批');
    expect(container.textContent).toContain('权限: ask');
  });

  it('fires allow-once with rememberScope "once"', () => {
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="gate-allow-once"]');
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('allow', 'once');
  });

  it('fires allow-session with rememberScope "session" (ADR 0024)', () => {
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="gate-allow-session"]');
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('allow', 'session');
  });

  it('fires deny with no remember scope', () => {
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="gate-deny"]');
    expect(btn).not.toBeNull();
    act(() => {
      btn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('deny');
  });

  it('shows "总是允许" only when project remember is available and projectPath is set', () => {
    const onPermission = vi.fn();
    // command kind supports project remember
    const commandPrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf build',
      detail: 'rm -rf build',
      context: { kind: 'command', summary: 'bash: rm -rf build', command: 'rm -rf build' },
    };

    act(() =>
      root.render(
        <Harness prompt={commandPrompt} projectPath="/repo" onPermission={onPermission} />,
      ),
    );
    expect(container.querySelector('[data-testid="gate-allow-remember"]')).not.toBeNull();

    act(() =>
      root.render(
        <Harness prompt={commandPrompt} projectPath={null} onPermission={onPermission} />,
      ),
    );
    expect(container.querySelector('[data-testid="gate-allow-remember"]')).toBeNull();
  });

  it('fires allow-remember with rememberScope "project"', () => {
    const onPermission = vi.fn();
    const commandPrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf build',
      detail: 'rm -rf build',
      context: { kind: 'command', summary: 'bash: rm -rf build', command: 'rm -rf build' },
    };
    act(() =>
      root.render(
        <Harness prompt={commandPrompt} projectPath="/repo" onPermission={onPermission} />,
      ),
    );
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="gate-allow-remember"]');
    act(() => {
      btn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('allow', 'project');
  });
});
