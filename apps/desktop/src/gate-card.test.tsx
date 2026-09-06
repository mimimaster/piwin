// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GateCard } from './gate-card';
import type { PermissionPromptUi } from './chat-reducer';

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
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  const prompt: PermissionPromptUi = {
    sessionId: 'sess-1',
    requestId: 'perm-1',
    action: 'bash',
    detail: 'git push --force-with-lease origin feat/composer-queue',
    defaultDecision: 'ask',
    context: {
      kind: 'command',
      command: 'git push --force-with-lease origin feat/composer-queue',
      summary: '命令',
      destructive: true,
    },
  };

  it('renders ink-line seal gate structure with seals and links', () => {
    const onPermission = vi.fn();
    act(() => {
      root.render(
        <GateCard prompt={prompt} projectPath="/repo" onPermission={onPermission} />,
      );
    });

    const gate = container.querySelector('[data-testid="permission-gate"]');
    expect(gate).not.toBeNull();
    const allowBtn = container.querySelector('[data-testid="gate-allow-once"]');
    expect(allowBtn?.textContent).toContain('允');
    const denyBtn = container.querySelector('[data-testid="gate-deny"]');
    expect(denyBtn?.textContent).toContain('否');
    const allowSession = container.querySelector('[data-testid="gate-allow-session"]');
    expect(allowSession?.textContent).toContain('允 · 本会话');
    const allowProject = container.querySelector('[data-testid="gate-allow-remember"]');
    expect(allowProject?.textContent).toContain('允 · 项目');
  });

  it('handles deny click', () => {
    const onPermission = vi.fn();
    act(() => {
      root.render(
        <GateCard prompt={prompt} projectPath="/repo" onPermission={onPermission} />,
      );
    });

    const denyBtn = container.querySelector<HTMLButtonElement>('[data-testid="gate-deny"]');
    act(() => {
      denyBtn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('deny');
  });

  it('handles allow-session click', () => {
    const onPermission = vi.fn();
    act(() => {
      root.render(
        <GateCard prompt={prompt} projectPath="/repo" onPermission={onPermission} />,
      );
    });

    const sessionBtn = container.querySelector<HTMLElement>('[data-testid="gate-allow-session"]');
    act(() => {
      sessionBtn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('allow', 'session');
  });

  it('handles allow-project click', () => {
    const onPermission = vi.fn();
    act(() => {
      root.render(
        <GateCard prompt={prompt} projectPath="/repo" onPermission={onPermission} />,
      );
    });

    const projectBtn = container.querySelector<HTMLElement>('[data-testid="gate-allow-remember"]');
    act(() => {
      projectBtn?.click();
    });
    expect(onPermission).toHaveBeenCalledWith('allow', 'project');
  });
});
