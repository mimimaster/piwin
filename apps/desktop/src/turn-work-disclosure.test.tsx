// @vitest-environment happy-dom
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { TurnWorkDisclosure } from './turn-work-disclosure.js';
import type { TurnWorkDisclosureProjection } from './turn-work-disclosure-model.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const PROJECTION: TurnWorkDisclosureProjection = {
  startIndex: 1,
  endIndex: 2,
  elapsedMs: 94_000,
  failureCount: 0,
};

function DisclosureHarness(props: {
  projection: TurnWorkDisclosureProjection;
  defaultOpen: boolean;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const [explicitOpen, setExplicitOpen] = useState<boolean | null>(null);
  const open = explicitOpen ?? props.defaultOpen;
  return (
    <>
      <TurnWorkDisclosure
        projection={props.projection}
        open={open}
        locale={props.locale}
        onToggle={() => setExplicitOpen(!open)}
      />
      {open ? <div data-testid="work-rows">Work rows</div> : null}
      <div data-testid="final-answer">Final answer</div>
    </>
  );
}

describe('TurnWorkDisclosure', () => {
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

  function renderHarness(
    projection: TurnWorkDisclosureProjection = PROJECTION,
    options: { defaultOpen?: boolean; locale?: 'zh-CN' | 'en' } = {},
  ): void {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DisclosureHarness
          projection={projection}
          defaultOpen={options.defaultOpen ?? false}
          locale={options.locale ?? 'en'}
        />
      </PiwinUiProvider>,
    );
  }

  it('exposes an accessible compact duration control', () => {
    const onToggle = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnWorkDisclosure
            projection={PROJECTION}
            open={false}
            locale="en"
            onToggle={onToggle}
          />
        </PiwinUiProvider>,
      );
    });

    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toContain('Worked for 1m 34s');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    act(() => trigger?.click());
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('preserves explicit open and closed intent across parent rerenders', () => {
    act(() => renderHarness());
    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(container.querySelector('[data-testid="work-rows"]')).toBeNull();
    expect(container.querySelector('[data-testid="final-answer"]')).not.toBeNull();

    act(() => trigger?.click());
    expect(container.querySelector('[data-testid="work-rows"]')).not.toBeNull();

    act(() => renderHarness({ ...PROJECTION, elapsedMs: 95_000 }));
    expect(container.querySelector('[data-testid="work-rows"]')).not.toBeNull();

    act(() =>
      container.querySelector<HTMLElement>('[data-testid="turn-work-disclosure-trigger"]')?.click(),
    );
    act(() => renderHarness(PROJECTION, { defaultOpen: true }));
    expect(container.querySelector('[data-testid="work-rows"]')).toBeNull();
  });

  it('honors the always-open default and localized failure copy', () => {
    act(() =>
      renderHarness({ ...PROJECTION, failureCount: 2 }, { defaultOpen: true, locale: 'zh-CN' }),
    );

    expect(
      container.querySelector('[data-testid="turn-work-disclosure-trigger"]')?.textContent,
    ).toContain('已工作 1m 34s · 2 次失败');
    expect(container.querySelector('[data-testid="work-rows"]')).not.toBeNull();
  });

  it('renders zh-CN fallback copy when elapsedMs is undefined', () => {
    act(() =>
      renderHarness(
        { startIndex: 1, endIndex: 2, failureCount: 2 },
        { defaultOpen: false, locale: 'zh-CN' },
      ),
    );

    expect(
      container.querySelector('[data-testid="turn-work-disclosure-trigger"]')?.textContent,
    ).toContain('已工作 · 2 次失败');
  });

  it('renders prototype-matching tool count, file count, and failure badges', () => {
    act(() =>
      renderHarness(
        {
          startIndex: 1,
          endIndex: 2,
          elapsedMs: 41_000,
          toolCount: 5,
          fileCount: 2,
          failureCount: 1,
        },
        { defaultOpen: false, locale: 'zh-CN' },
      ),
    );

    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toBe('已工作 41s · 5 个工具 · 2 个文件 · 1 次失败');
    expect(trigger?.querySelector('.fail')?.textContent).toBe('1 次失败');
    expect(trigger?.querySelector('.work-fold-bulb')).not.toBeNull();
    expect(trigger?.querySelector('.work-fold-brain')).toBeNull();
    expect(trigger?.querySelector('svg.chev')?.innerHTML).toContain('M6 4l4 4-4 4');
  });

  it('renders running narration, tool count, and command during a live run', () => {
    act(() =>
      renderHarness(
        {
          startIndex: 1,
          endIndex: 2,
          failureCount: 0,
          toolCount: 2,
          live: true,
          runningToolIndex: 2,
          runningTool: {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'running',
            output: '',
            presentation: { kind: 'shell', title: 'pnpm test', command: 'pnpm test' },
          },
          latestNarration: '正在运行测试套件',
        },
        { defaultOpen: false, locale: 'zh-CN' },
      ),
    );

    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toBe('正在运行 · 正在运行测试套件 · 第 2 个工具 · pnpm test');
    expect(trigger?.querySelector('.work-fold-narration')?.textContent).toBe('正在运行测试套件');
    expect(trigger?.querySelector('code')?.textContent).toBe('pnpm test');
  });
});
