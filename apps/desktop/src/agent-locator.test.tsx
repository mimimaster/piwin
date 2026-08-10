// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { AgentLocator, SkillActivityChip } from './agent-locator.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('AgentLocator', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.parentNode?.removeChild(container);
    window.matchMedia = previousMatchMedia;
  });

  function render(node: ReactElement): void {
    act(() => {
      root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
    });
  }

  it('uses the radial bellow as the default locator and exposes the run behavior id', () => {
    render(<AgentLocator input={{ kind: 'connecting-model', locale: 'en' }} />);
    const locator = container.querySelector('[data-testid="agent-locator"]');
    expect(locator?.getAttribute('data-animation')).toBe('radial-bellow');
    expect(locator?.getAttribute('data-activity-id')).toBe('run.connect');
    expect(locator?.textContent).toContain('Connecting to model…');
    expect(container.querySelector('[data-testid="agent-locator-radial-bellow"]')).not.toBeNull();
  });

  it('rotates preparing phrases with shimmer copy in English and Chinese', () => {
    render(<AgentLocator input={{ kind: 'preparing', locale: 'en' }} />);
    const locator = container.querySelector('[data-testid="agent-locator"]');
    const copy = container.querySelector('[data-testid="agent-locator-copy"]');
    expect(locator?.getAttribute('data-kind')).toBe('preparing');
    expect(locator?.getAttribute('data-phrase-count')).toBe('3');
    expect(copy?.classList.contains('agent-locator-copy--shimmer')).toBe(true);
    expect(copy?.textContent).toBe('Preparing context…');

    render(<AgentLocator input={{ kind: 'preparing', locale: 'zh-CN' }} />);
    expect(container.querySelector('[data-testid="agent-locator-copy"]')?.textContent).toBe(
      '准备上下文…',
    );
    expect(
      container.querySelector('[data-testid="agent-locator-copy"]')?.classList.contains(
        'agent-locator-copy--shimmer',
      ),
    ).toBe(true);
  });

  it('renders a loading Skill context chip separately from the run locator', () => {
    render(
      <SkillActivityChip
        skill={{ skillId: 'writing-plans', name: 'writing-plans' }}
        loading
        locale="zh-CN"
      />,
    );
    const chip = container.querySelector('[data-testid="skill-activity-chip"]');
    expect(chip?.getAttribute('data-activity-id')).toBe('skill.load');
    expect(chip?.textContent).toContain('加载技能：writing-plans');
    expect(container.querySelector('[data-testid="skill-activity-matrix"]')).not.toBeNull();
  });
});
