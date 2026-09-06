// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PermissionBar } from './permission-bar';
import { DesktopLocaleProvider } from './desktop-locale-context';
import type { PermissionPromptUi } from './chat-reducer';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const basePrompt: PermissionPromptUi = {
  requestId: 'req-1',
  sessionId: 'sess-1',
  action: 'bash:ls',
  detail: 'ls -la',
  defaultDecision: 'ask',
};

function Harness(props: {
  prompt: PermissionPromptUi;
  projectPath: string | null;
  onPermission: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
}): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <PermissionBar
          prompt={props.prompt}
          projectPath={props.projectPath}
          onPermission={props.onPermission}
        />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
}

describe('PermissionBar', () => {
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
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders the permission bar with subject label', () => {
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={vi.fn()} />),
    );
    const bar = container.querySelector('[data-testid="permission-bar"]');
    expect(bar).not.toBeNull();
    const title = bar?.querySelector('.agent-interruption-title');
    expect(title?.textContent).toContain('bash:ls');
  });

  it('fires allow-session with rememberScope "session" after the seal-stamp flourish', () => {
    vi.useFakeTimers();
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-allow-session"]',
    );
    expect(btn).not.toBeNull();
    act(() => btn?.click());
    // The stamp animation holds the decision briefly before it fires.
    expect(onPermission).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onPermission).toHaveBeenCalledWith('allow', 'session');
    vi.useRealTimers();
  });

  it('grants allow-session on Enter and denies on Escape (seal keyboard contract)', () => {
    vi.useFakeTimers();
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(onPermission).toHaveBeenCalledWith('allow', 'session');
    onPermission.mockClear();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onPermission).toHaveBeenCalledWith('deny');
    vi.useRealTimers();
  });

  it('does not treat Enter/Escape as a decision while an editable field has focus', () => {
    vi.useFakeTimers();
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(onPermission).not.toHaveBeenCalled();
    input.remove();
    vi.useRealTimers();
  });

  it('fires allow-once with rememberScope "once"', () => {
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-allow-once"]',
    );
    expect(btn).not.toBeNull();
    act(() => btn?.click());
    expect(onPermission).toHaveBeenCalledWith('allow', 'once');
  });

  it('fires deny with no remember scope', () => {
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const btn = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-deny"]',
    );
    expect(btn).not.toBeNull();
    act(() => btn?.click());
    expect(onPermission).toHaveBeenCalledWith('deny');
  });

  it('shows allow-project button for command prompts with a project', () => {
    const commandPrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf build',
      detail: 'rm -rf build',
      context: { kind: 'command', summary: 'bash: rm -rf build', command: 'rm -rf build' },
    };
    act(() =>
      root.render(<Harness prompt={commandPrompt} projectPath="/repo" onPermission={vi.fn()} />),
    );
    expect(container.querySelector('[data-testid="permission-bar-allow-project"]')).not.toBeNull();
  });

  it('hides allow-project button when no project path', () => {
    const commandPrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf build',
      detail: 'rm -rf build',
      context: { kind: 'command', summary: 'bash: rm -rf build', command: 'rm -rf build' },
    };
    act(() =>
      root.render(<Harness prompt={commandPrompt} projectPath={null} onPermission={vi.fn()} />),
    );
    expect(container.querySelector('[data-testid="permission-bar-allow-project"]')).toBeNull();
  });

  it('expands detail on toggle click', () => {
    const commandPrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf build',
      detail: 'rm -rf build',
      context: { kind: 'command', summary: 'bash: rm -rf build', command: 'rm -rf build' },
    };
    act(() =>
      root.render(<Harness prompt={commandPrompt} projectPath="/repo" onPermission={vi.fn()} />),
    );
   // Non-destructive: details start collapsed
    // Collapse keeps children in DOM (keepMounted); check aria-expanded instead.
   const toggle = container.querySelector<HTMLButtonElement>(
     '[data-testid="permission-bar-toggle"]',
   );
   expect(toggle).not.toBeNull();
   expect(toggle?.getAttribute('aria-expanded')).toBe('false');
   act(() => toggle?.click());
   expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('starts expanded for destructive context', () => {
    const destructivePrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf /',
      detail: 'rm -rf /',
      context: {
        kind: 'command',
        summary: 'bash: rm -rf /',
        command: 'rm -rf /',
        destructive: true,
      },
    };
    act(() =>
      root.render(
        <Harness prompt={destructivePrompt} projectPath="/repo" onPermission={vi.fn()} />,
      ),
    );
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-toggle"]',
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-testid="permission-bar-detail"]')).not.toBeNull();
  });

  it('applies danger tone for destructive context', () => {
    const destructivePrompt: PermissionPromptUi = {
      ...basePrompt,
      action: 'bash:rm -rf /',
      detail: 'rm -rf /',
      context: {
        kind: 'command',
        summary: 'bash: rm -rf /',
        command: 'rm -rf /',
        destructive: true,
      },
    };
    act(() =>
      root.render(
        <Harness prompt={destructivePrompt} projectPath="/repo" onPermission={vi.fn()} />,
      ),
    );
    const bar = container.querySelector('[data-testid="permission-bar"]');
    expect(bar?.classList.contains('agent-interruption--danger')).toBe(true);
  });

  it('uses localized labels', () => {
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={vi.fn()} />),
    );
    const sessionBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-allow-session"]',
    );
    expect(sessionBtn?.textContent).toContain('Allow for this session');
    const denyBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-deny"]',
    );
    expect(denyBtn?.textContent).toContain('Deny');
  });
});
