// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThinkingLevel } from '@piwin/contracts';
import { PhoneEffortChip } from './phone-effort-chip.js';
import { PhoneModelSheet } from './phone-model-sheet.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root;
let host: HTMLDivElement;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const fire = (target: Element, type: string, x = 50, y = 50) =>
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y }),
    );
  });
const tap = (target: Element) => {
  fire(target, 'pointerdown');
  fire(target, 'pointerup');
};

function mount(levels: ThinkingLevel[], value: ThinkingLevel = 'medium', onChange = vi.fn()) {
  act(() =>
    root.render(
      <PhoneEffortChip disabled={false} isZh levels={levels} value={value} modelName="Sonnet 4.6" onChange={onChange} />,
    ),
  );
  return onChange;
}
const FOUR: ThinkingLevel[] = ['off', 'low', 'medium', 'high'];

describe('PhoneEffortChip', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('renders nothing when the model supports no thinking', () => {
    mount([]);
    expect(host.innerHTML).toBe('');
  });

  it('shows bulb + current level and opens a popover of bare level names', () => {
    mount(FOUR);
    const chip = q('[data-testid="pec-chip"]')!;
    expect(chip.querySelector('.pec-level')!.textContent).toBe('中');
    expect(chip.querySelector('.pec-bulb')).not.toBeNull();
    act(() => chip.click());
    expect(q('[data-testid="pec-pop"]')).not.toBeNull();
    for (const level of FOUR) {
      const item = q(`[data-testid="pec-level-${level}"]`)!;
      expect(item.textContent).toBe({ off: '关', low: '低', medium: '中', high: '高' }[level as string]);
      expect(item.querySelector('small')).toBeNull();
    }
    expect(q('[data-testid="pec-level-medium"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('a still tap picks the level and closes the popover', () => {
    const onChange = mount(FOUR);
    act(() => q('[data-testid="pec-chip"]')!.click());
    tap(q('[data-testid="pec-level-high"]')!);
    expect(onChange).toHaveBeenCalledWith('high');
    expect(q('[data-testid="pec-layer"]')).toBeNull();
  });

  it('a press that moves more than 8px does not pick', () => {
    const onChange = mount(FOUR);
    act(() => q('[data-testid="pec-chip"]')!.click());
    const item = q('[data-testid="pec-level-low"]')!;
    fire(item, 'pointerdown', 50, 50);
    fire(item, 'pointermove', 50, 70);
    fire(item, 'pointerup', 50, 70);
    expect(onChange).not.toHaveBeenCalled();
    expect(q('[data-testid="pec-layer"]')).not.toBeNull();
  });

  it('outside tap closes only when still; a swipe ending outside keeps it open', () => {
    mount(FOUR);
    act(() => q('[data-testid="pec-chip"]')!.click());
    const scrim = q('[data-testid="pec-scrim"]')!;
    fire(scrim, 'pointerdown', 100, 100);
    fire(scrim, 'pointerup', 100, 160);
    expect(q('[data-testid="pec-layer"]')).not.toBeNull();
    tap(scrim);
    expect(q('[data-testid="pec-layer"]')).toBeNull();
  });

  it('exactly two levels renders a plain toggle chip, no popover', () => {
    const onChange = mount(['off', 'high'], 'off');
    const toggle = q('[data-testid="pec-toggle"]')!;
    expect(q('[data-testid="pec-chip"]')).toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.querySelector('.pec-level')!.textContent).toBe('关');
    act(() => toggle.click());
    expect(onChange).toHaveBeenCalledWith('high');
    expect(q('[data-testid="pec-layer"]')).toBeNull();
  });

  it('the phone model sheet itself has no effort control', () => {
    act(() =>
      root.render(
        <PhoneModelSheet
          disabled={false}
          isZh
          modelLabel="m"
          ultraEnabled={false}
          value="medium"
          onChange={vi.fn()}
          models={[{ key: 'a:b', label: 'A / B', thinkingLevels: FOUR, reasoning: true }]}
          selectedModelKey="a:b"
        />,
      ),
    );
    expect(q('[data-testid="pec-chip"]')).not.toBeNull();
    act(() => q('[data-testid="thinking-effort-trigger"]')!.click());
    expect(q('[data-testid="pms-sheet"] [role="radiogroup"]')).toBeNull();
    expect(q('.pms-pill-effort')).toBeNull();
  });
});
