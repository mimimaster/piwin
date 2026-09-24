// @vitest-environment happy-dom
import { act, useState, type ReactElement, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptScrollProvider } from './transcript-scroll-port.js';
import { useTranscriptLocalFoldMeasure } from './use-transcript-local-fold-measure.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

let setAutomaticOpen: ((open: boolean) => void) | null = null;

function Fold(): ReactElement {
  const [open, setOpen] = useState(false);
  setAutomaticOpen = setOpen;
  const fold = useTranscriptLocalFoldMeasure(open);
  return (
    <div ref={fold.setRoot}>
      <button
        type="button"
        onClick={() => {
          fold.onUserToggle();
          setOpen((current) => !current);
        }}
      >
        toggle
      </button>
    </div>
  );
}

function mount(): { grew: () => number; detached: () => number; button: HTMLButtonElement } {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  let grewCount = 0;
  let detachCount = 0;
  const scrollElementRef: RefObject<HTMLDivElement | null> = { current: null };
  act(() => {
    root?.render(
      <TranscriptScrollProvider
        sessionId="fold"
        scrollElementRef={scrollElementRef}
        notifyContentGrew={() => {
          grewCount += 1;
        }}
        beginLocalFoldLayout={() => undefined}
        detachFromTail={() => {
          detachCount += 1;
        }}
      >
        <Fold />
      </TranscriptScrollProvider>,
    );
  });
  const button = container.querySelector('button');
  if (!button) throw new Error('fold button missing');
  return { grew: () => grewCount, detached: () => detachCount, button };
}

describe('useTranscriptLocalFoldMeasure', () => {
  it('keeps the viewport on user toggles', () => {
    const { grew, button } = mount();
    act(() => button.click());
    act(() => button.click());
    expect(grew()).toBe(0);
  });

  it('leaves follow-tail when the user opens a fold, not when they close it', () => {
    const { detached, button } = mount();
    act(() => button.click());
    expect(detached()).toBe(1);
    act(() => button.click());
    expect(detached()).toBe(1);
  });

  it('follows the tail when a fold opens on its own', () => {
    const { grew } = mount();
    act(() => setAutomaticOpen?.(true));
    expect(grew()).toBe(1);
  });
});
