// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ComposerDockProps } from './composer-dock-types';
import { useTranscriptComposerCard } from './transcript-composer-card.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function baseCard(overrides: Partial<ComposerDockProps> = {}): ComposerDockProps {
  // Only the fields the hook inspects matter here; the rest is opaque data.
  return {
    composer: '',
    modelOptions: [],
    selectedModelKey: 'acme/one',
    onSelectModel: vi.fn(),
    onAbort: vi.fn(),
    onAgentModeChange: vi.fn(),
    ...overrides,
  } as unknown as ComposerDockProps;
}

describe('useTranscriptComposerCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen: ComposerDockProps[] = [];

  function Probe(props: { card: ComposerDockProps }): ReactElement | null {
    seen.push(useTranscriptComposerCard(props.card));
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    seen.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps identity while the draft text and handler closures change', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    const firstAbort = vi.fn();
    const secondAbort = vi.fn();
    act(() =>
      root.render(<Probe card={baseCard({ composer: 'h', modelOptions, onAbort: firstAbort })} />),
    );
    act(() =>
      root.render(
        <Probe card={baseCard({ composer: 'he', modelOptions, onAbort: secondAbort })} />,
      ),
    );

    expect(seen[1]).toBe(seen[0]);
    seen[1]?.onAbort();
    expect(firstAbort).not.toHaveBeenCalled();
    expect(secondAbort).toHaveBeenCalledTimes(1);
  });

  it('updates when a transcript-read data field changes', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({ modelOptions })} />));
    act(() =>
      root.render(<Probe card={baseCard({ modelOptions, selectedModelKey: 'acme/two' })} />),
    );

    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[1]?.selectedModelKey).toBe('acme/two');
  });

  it('exposes an optional handler only while the source provides one', () => {
    const modelOptions: ComposerDockProps['modelOptions'] = [];
    act(() => root.render(<Probe card={baseCard({ modelOptions })} />));
    expect(seen[0]?.onOrchestrationSchemeChange).toBeUndefined();
    const onOrchestrationSchemeChange = vi.fn();
    act(() =>
      root.render(<Probe card={baseCard({ modelOptions, onOrchestrationSchemeChange })} />),
    );
    expect(seen[1]).not.toBe(seen[0]);
    seen[1]?.onOrchestrationSchemeChange?.('plan');
    expect(onOrchestrationSchemeChange).toHaveBeenCalledWith('plan');
  });
});
