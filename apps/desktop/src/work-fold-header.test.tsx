// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatLiveElapsed, WorkFoldHeader } from './work-fold-header.js';

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

  it('keeps the brain on a running thinking header', () => {
    act(() => {
      root.render(
        <WorkFoldHeader
          state="running"
          locale="zh-CN"
          doneIcon="brain"
          runningSince={Date.now() - 4_000}
          testId="think-running"
        >
          思考过程
        </WorkFoldHeader>,
      );
    });

    const header = container.querySelector('[data-testid="think-running"]');
    expect(header?.querySelector('.work-fold-brain')).not.toBeNull();
    expect(header?.querySelector('.lamp')).toBeNull();
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

  it('formats the live clock compactly and pads the trailing unit', () => {
    expect(formatLiveElapsed(0)).toBe('0s');
    expect(formatLiveElapsed(12_400)).toBe('12s');
    expect(formatLiveElapsed(59_999)).toBe('59s');
    expect(formatLiveElapsed(65_000)).toBe('1m 05s');
    expect(formatLiveElapsed(3_599_000)).toBe('59m 59s');
    expect(formatLiveElapsed(3_720_000)).toBe('1h 02m');
  });

  it('ticks a live clock while running and omits it without a run start', () => {
    vi.useFakeTimers();
    try {
      const startedAt = Date.now();
      act(() => {
        root.render(
          <>
            <WorkFoldHeader
              state="running"
              locale="zh-CN"
              runningToolIndex={5}
              runningSince={startedAt}
              testId="run-clock"
            />
            <WorkFoldHeader state="running" locale="zh-CN" runningToolIndex={5} testId="run-bare" />
          </>,
        );
      });

      const clock = () =>
        container.querySelector('[data-testid="run-clock"] [data-testid="work-fold-elapsed"]');
      expect(clock()?.textContent).toBe('0s');

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(clock()?.textContent).toBe('5s');

      // No `runningSince` means no clock at all, rather than a misleading 0s.
      expect(
        container.querySelector('[data-testid="run-bare"] [data-testid="work-fold-elapsed"]'),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins thinking duration to the trailing right edge, not the title', () => {
    act(() => {
      root.render(
        <WorkFoldHeader
          state="done"
          locale="zh-CN"
          elapsedMs={4_000}
          open
          onToggle={() => undefined}
          testId="think-elapsed"
        >
          思考过程
        </WorkFoldHeader>,
      );
    });

    const header = container.querySelector('[data-testid="think-elapsed"]');
    const elapsed = header?.querySelector('[data-testid="work-fold-elapsed"]');
    expect(header?.querySelector('.work-fold-trailing')).not.toBeNull();
    expect(header?.querySelector('.turn-work-details-label')?.textContent).toBe('思考过程');
    expect(elapsed?.textContent).toBe('4s');
    expect(elapsed?.parentElement?.className).toContain('work-fold-trailing');
    expect(header?.textContent).not.toContain('已思考');
    expect(header?.textContent).not.toContain('已工作');
  });

  it('asks the transcript virtualizer to remasure after a user toggle', () => {
    const measureEvents: Event[] = [];
    const onMeasure = (event: Event): void => {
      measureEvents.push(event);
    };
    document.addEventListener('piwin:transcript-turn-measure', onMeasure);
    let open = false;

    const renderHeader = (): void => {
      root.render(
        <div className="transcript-turn-window-item-body">
          <WorkFoldHeader
            state="done"
            locale="zh-CN"
            doneIcon="brain"
            open={open}
            onToggle={() => {
              open = !open;
              renderHeader();
            }}
            testId="think-toggle"
          >
            思考过程
          </WorkFoldHeader>
        </div>,
      );
    };

    act(() => {
      renderHeader();
    });
    const measureCountBeforeToggle = measureEvents.length;

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="think-toggle"]')?.click();
    });

    expect(open).toBe(true);
    expect(measureEvents.length).toBeGreaterThan(measureCountBeforeToggle);
    document.removeEventListener('piwin:transcript-turn-measure', onMeasure);
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

  it('renders running copy with latest narration, tool index, and command code', () => {
    act(() => {
      root.render(
        <>
          <WorkFoldHeader
            state="running"
            locale="zh-CN"
            narration="正在检查文件结构"
            runningToolIndex={3}
            runningCode="git status"
            testId="run-narration-zh"
          />
          <WorkFoldHeader
            state="running"
            locale="en"
            narration="Inspecting file structure"
            runningToolIndex={3}
            runningCode="git status"
            testId="run-narration-en"
          />
          <WorkFoldHeader
            state="running"
            locale="zh-CN"
            narration="仅有叙述与工具"
            runningToolIndex={2}
            testId="run-narration-nocode"
          />
          <WorkFoldHeader
            state="running"
            locale="zh-CN"
            runningToolIndex={3}
            testId="run-fallback"
          />
        </>,
      );
    });

    const zh = container.querySelector('[data-testid="run-narration-zh"]');
    expect(zh?.textContent).toBe('正在运行 · 正在检查文件结构 · 第 3 个工具 · git status');
    expect(zh?.querySelector('.work-fold-narration')?.textContent).toBe('正在检查文件结构');
    expect(zh?.querySelector('code')?.textContent).toBe('git status');
    expect(zh?.querySelector('.work-fold-running-tail')?.textContent).toBe(' · 第 3 个工具 · git status');

    const en = container.querySelector('[data-testid="run-narration-en"]');
    expect(en?.textContent).toBe('Running · Inspecting file structure · tool 3 · git status');
    expect(en?.querySelector('.work-fold-narration')?.textContent).toBe('Inspecting file structure');

    const nocode = container.querySelector('[data-testid="run-narration-nocode"]');
    expect(nocode?.textContent).toBe('正在运行 · 仅有叙述与工具 · 第 2 个工具');
    expect(nocode?.querySelector('code')).toBeNull();

    const fallback = container.querySelector('[data-testid="run-fallback"]');
    expect(fallback?.textContent).toBe('正在运行 · 第 3 个工具');
    expect(fallback?.querySelector('.work-fold-narration')).toBeNull();
  });
});
