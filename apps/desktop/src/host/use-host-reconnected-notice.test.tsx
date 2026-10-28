// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const showSuccessNotification = vi.fn();
vi.mock('@piwin/ui-kit', () => ({ showSuccessNotification }));

const { useHostReconnectedNotice } = await import('./use-host-reconnected-notice.js');

function Probe(props: { down: boolean }): null {
  useHostReconnectedNotice(props.down, 'back');
  return null;
}

describe('useHostReconnectedNotice', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    showSuccessNotification.mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  function render(down: boolean): void {
    act(() => root.render(<Probe down={down} />));
  }

  it('says nothing when the link was never down', () => {
    render(false);
    render(false);
    expect(showSuccessNotification).not.toHaveBeenCalled();
  });

  it('stays quiet after a brief hand-over drop', () => {
    render(false);
    render(true);
    vi.advanceTimersByTime(800);
    render(false);
    expect(showSuccessNotification).not.toHaveBeenCalled();
  });

  it('announces the end of a noticeable outage once', () => {
    render(true);
    vi.advanceTimersByTime(2_000);
    render(false);
    render(false);
    expect(showSuccessNotification).toHaveBeenCalledTimes(1);
    expect(showSuccessNotification).toHaveBeenCalledWith('back');
  });
});
