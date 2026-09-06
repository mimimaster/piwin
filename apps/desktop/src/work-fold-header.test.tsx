// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkFoldHeader } from './work-fold-header.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('WorkFoldHeader', () => {
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

  it('renders proto-01 running and waiting copy with code capsules', () => {
    act(() => {
      root.render(
        <>
          <WorkFoldHeader
            state="running"
            locale="zh-CN"
            runningToolIndex={5}
            runningCode="pnpm typecheck"
            testId="run"
          />
          <WorkFoldHeader
            state="waiting"
            locale="zh-CN"
            waitingAction="写入"
            waitingCode="composer-run-actions.tsx"
            testId="wait"
          />
        </>,
      );
    });

    const running = container.querySelector('[data-testid="run"]');
    expect(running?.querySelector('.lamp')).not.toBeNull();
    expect(running?.textContent).toBe('正在运行 · 第 5 个工具 · pnpm typecheck');
    expect(running?.querySelector('code')?.textContent).toBe('pnpm typecheck');

    const waiting = container.querySelector('[data-testid="wait"]');
    expect(waiting?.querySelector('.sq')).not.toBeNull();
    expect(waiting?.textContent).toBe('等待你批准 · 写入 composer-run-actions.tsx');
    expect(waiting?.querySelector('code')?.textContent).toBe('composer-run-actions.tsx');
  });
});
