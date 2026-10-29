// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneModelSheet } from './phone-model-sheet.js';
import { RECENT_MODELS_KEY } from './recent-models.js';
import type { ThinkingEffortModelOption } from './ThinkingEffortControl.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const models: ThinkingEffortModelOption[] = Array.from({ length: 45 }, (_, i) => ({
  key: `p${i % 5}:m${i}`,
  label: `Prov${i % 5} / model-${i}`,
  providerName: `Prov${i % 5}`,
  thinkingLevels: ['off', 'low', 'medium', 'high'],
  reasoning: i % 2 === 0,
}));

let root: Root;
let host: HTMLDivElement;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const fire = (target: Element, type: string, init: PointerEventInit = {}) =>
  act(() => {
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        ...init,
      }),
    );
  });
const tap = (target: Element) => {
  fire(target, 'pointerdown', { clientX: 50, clientY: 50 });
  fire(target, 'pointerup', { clientX: 50, clientY: 50 });
};
const rowFor = (key: string) =>
  qa('[data-testid="pms-row"]').find(
    (row) => row.dataset.key === key && !row.closest('[data-testid="pms-recent"]'),
  )!;

function mount(onSelectModel = vi.fn(), selectedModelKey = 'p0:m0') {
  act(() =>
    root.render(
      <PhoneModelSheet
        disabled={false}
        isZh={true}
        modelLabel="model-0"
        ultraEnabled={false}
        value="medium"
        onChange={vi.fn()}
        models={models}
        selectedModelKey={selectedModelKey}
        onSelectModel={onSelectModel}
      />,
    ),
  );
  act(() => q('[data-testid="thinking-effort-trigger"]')!.click());
  return onSelectModel;
}

describe('PhoneModelSheet', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('groups 45 models by provider with sticky headers and a recent group', () => {
    mount();
    expect(qa('.pms-sec').map((s) => s.firstChild?.textContent)).toEqual([
      '最近使用',
      'Prov0',
      'Prov1',
      'Prov2',
      'Prov3',
      'Prov4',
    ]);
    expect(qa('[data-testid="pms-row"]').length).toBe(45 + 1);
  });

  it('stays open after a tap selects a model', () => {
    const onSelect = mount();
    tap(rowFor('p1:m1'));
    expect(onSelect).toHaveBeenCalledWith('p1:m1');
    expect(q('[data-testid="pms-sheet"]')).not.toBeNull();
  });

  it('a swipe across rows never selects', () => {
    const onSelect = mount();
    const row = rowFor('p2:m2');
    fire(row, 'pointerdown', { clientX: 50, clientY: 300 });
    fire(row, 'pointermove', { clientX: 50, clientY: 250 });
    fire(row, 'pointerup', { clientX: 50, clientY: 120 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes only when the handle is dragged more than 120px', () => {
    mount();
    const handle = q('[data-testid="pms-handle"]')!;
    fire(handle, 'pointerdown', { clientY: 100 });
    fire(handle, 'pointermove', { clientY: 200 });
    fire(handle, 'pointerup', { clientY: 200 });
    expect(q('[data-testid="pms-sheet"]')).not.toBeNull();
    fire(handle, 'pointerdown', { clientY: 100 });
    fire(handle, 'pointermove', { clientY: 230 });
    fire(handle, 'pointerup', { clientY: 230 });
    expect(q('[data-testid="pms-sheet"]')).toBeNull();
  });

  it('dragging the list (not the handle) does not close', () => {
    mount();
    const list = q('[data-testid="pms-list"]')!;
    fire(list, 'pointerdown', { clientY: 100 });
    fire(list, 'pointermove', { clientY: 400 });
    fire(list, 'pointerup', { clientY: 400 });
    expect(q('[data-testid="pms-sheet"]')).not.toBeNull();
  });

  it('closes on a still scrim tap but not on a swipe that ends on the scrim', () => {
    mount();
    const scrim = q('[data-testid="pms-scrim"]')!;
    fire(scrim, 'pointerdown', { clientX: 10, clientY: 10 });
    fire(scrim, 'pointerup', { clientX: 10, clientY: 60 });
    expect(q('[data-testid="pms-sheet"]')).not.toBeNull();
    tap(scrim);
    expect(q('[data-testid="pms-sheet"]')).toBeNull();
  });

  it('keeps 3 recent models, newest first', () => {
    window.localStorage.setItem(
      RECENT_MODELS_KEY,
      JSON.stringify(['p3:m3', 'p4:m4', 'p1:m6', 'p2:m7']),
    );
    mount();
    const recent = qa('[data-testid="pms-recent"] [data-testid="pms-row"]').map(
      (r) => r.dataset.key,
    );
    expect(recent).toEqual(['p0:m0', 'p3:m3', 'p4:m4']);
  });

  it('filters by provider and by search', () => {
    mount();
    act(() =>
      qa('.pms-filter button')
        .find((b) => b.textContent === 'Prov2')!
        .click(),
    );
    expect(new Set(qa('[data-testid="pms-row"]').map((r) => r.dataset.key!.split(':')[0]))).toEqual(
      new Set(['p2']),
    );
    const input = q('[data-testid="pms-search"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'model-44');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    expect(qa('[data-testid="pms-row"]').map((r) => r.dataset.key)).toEqual(['p4:m44']);
  });
});
