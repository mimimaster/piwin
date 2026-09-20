// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PermissionBar } from './permission-bar';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { createInitialChatUiState, type PermissionPromptUi } from './chat-reducer';
import type { PermissionDecision, PermissionRememberScope } from '@piwin/contracts';
import { WorkbenchPermissionBar } from './workbench-conversation';

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
  origin?: { kind: 'subagent' | 'session'; name: string; workingDirectory?: string };
}): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <PermissionBar
          prompt={props.prompt}
          projectPath={props.projectPath}
          onPermission={props.onPermission}
          {...(props.origin ? { origin: props.origin } : {})}
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

  it('does not grant when Enter lands on a focused button or Escape closes an open dialog', () => {
    vi.useFakeTimers();
    const onPermission = vi.fn();
    act(() =>
      root.render(<Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />),
    );
    const deny = container.querySelector<HTMLButtonElement>('[data-testid="permission-bar-deny"]');
    expect(deny).not.toBeNull();
    act(() => {
      deny?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(200));
    expect(onPermission).not.toHaveBeenCalledWith('allow', 'session');

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onPermission).not.toHaveBeenCalled();
    dialog.remove();
    vi.useRealTimers();
  });

  it('resolves a prompt rendered twice only once per keypress', () => {
    vi.useFakeTimers();
    const onPermission = vi.fn();
    act(() =>
      root.render(
        <>
          <Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />
          <Harness prompt={basePrompt} projectPath="/repo" onPermission={onPermission} />
        </>,
      ),
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onPermission).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('names the subagent and shows its workspace for a child prompt', () => {
    act(() =>
      root.render(
        <Harness
          prompt={basePrompt}
          projectPath="/repo"
          onPermission={vi.fn()}
          origin={{ kind: 'subagent', name: 'an-r05-r10-freeze', workingDirectory: '/wt/child' }}
        />,
      ),
    );
    const origin = container.querySelector('[data-testid="permission-bar-origin"]');
    expect(origin?.textContent).toContain('an-r05-r10-freeze');
    expect(container.textContent).toContain('/wt/child');
    expect(container.textContent).not.toContain('/repo');
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

  it('renders queue badge when queuedRemaining > 0', () => {
    act(() =>
      root.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <PermissionBar
              prompt={basePrompt}
              projectPath="/repo"
              queuedRemaining={3}
              onPermission={vi.fn()}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      ),
    );
    const badge = container.querySelector('[data-testid="permission-queue-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('还有 3 条待审批');
  });

  it('wraps the permission bar in composer-plan-stack even without an active plan tray', () => {
    const state = {
      ...createInitialChatUiState(),
      permissionPrompt: basePrompt,
      projectPath: '/repo',
    };
    act(() =>
      root.render(
        <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <WorkbenchPermissionBar
              state={state}
              sidebarMode="code"
              extensionUiRequest={null}
              sessionPlan={null}
              onPermission={vi.fn()}
              onExtensionUiResolve={vi.fn()}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      ),
    );
    const stack = container.querySelector('.composer-plan-stack');
    expect(stack).not.toBeNull();
    const bar = stack?.querySelector('[data-testid="permission-bar"]');
    expect(bar).not.toBeNull();
  });
});
