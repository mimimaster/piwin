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

  it('uses the two-hemisphere brain for done thinking and marks the chevron by open state', () => {
    act(() => {
      root.render(
        <>
          <WorkFoldHeader
            state="done"
            locale="zh-CN"
            doneIcon="brain"
            open={false}
            onToggle={() => undefined}
            testId="think-closed"
          >
            思考过程
          </WorkFoldHeader>
          <WorkFoldHeader
            state="done"
            locale="zh-CN"
            doneIcon="brain"
            open
            onToggle={() => undefined}
            testId="think-open"
          >
            思考过程
          </WorkFoldHeader>
        </>,
      );
    });

    const closed = container.querySelector('[data-testid="think-closed"]');
    const opened = container.querySelector('[data-testid="think-open"]');
    expect(closed?.querySelector('.work-fold-brain')?.innerHTML).toContain('M7.5 3.2');
    expect(closed?.getAttribute('aria-expanded')).toBe('false');
    expect(closed?.querySelector('.chev')?.innerHTML).toContain('M6 4l4 4-4 4');
    expect(opened?.getAttribute('aria-expanded')).toBe('true');
    expect(opened?.querySelector('.chev')?.innerHTML).toContain('M4 6l4 4 4-4');
  });

  it('keeps the proto bulb for done work disclosure', () => {
    act(() => {
      root.render(
        <WorkFoldHeader
          state="done"
          locale="zh-CN"
          elapsedMs={153_000}
          toolCount={4}
          testId="work-done"
        />,
      );
    });

    const header = container.querySelector('[data-testid="work-done"]');
    expect(header?.querySelector('.work-fold-bulb')?.innerHTML).toContain('M8 2.5');
    expect(header?.querySelector('.work-fold-brain')).toBeNull();
    expect(header?.textContent).toContain('已工作 2m 33s · 4 个工具');
  });
});
