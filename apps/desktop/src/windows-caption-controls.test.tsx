// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WindowsCaptionControls } from './windows-caption-controls.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const mockMinimize = vi.fn();
const mockToggleMaximize = vi.fn().mockResolvedValue(undefined);
const mockClose = vi.fn();
const mockIsMaximized = vi.fn().mockResolvedValue(false);
const mockOnResized = vi.fn().mockResolvedValue(() => {});

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: mockMinimize,
    toggleMaximize: mockToggleMaximize,
    close: mockClose,
    isMaximized: mockIsMaximized,
    onResized: mockOnResized,
  }),
}));

describe('WindowsCaptionControls', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockMinimize.mockClear();
    mockToggleMaximize.mockClear();
    mockClose.mockClear();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it('renders all three window controls', () => {
    act(() => {
      root?.render(<WindowsCaptionControls />);
    });

    expect(container?.querySelector('[data-testid="windows-caption-minimize"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="windows-caption-maximize"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="windows-caption-close"]')).not.toBeNull();
  });

  it('triggers window actions when clicking caption buttons in Tauri runtime', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    act(() => {
      root?.render(<WindowsCaptionControls />);
    });

    const minBtn = container?.querySelector<HTMLButtonElement>('[data-testid="windows-caption-minimize"]');
    const maxBtn = container?.querySelector<HTMLButtonElement>('[data-testid="windows-caption-maximize"]');
    const closeBtn = container?.querySelector<HTMLButtonElement>('[data-testid="windows-caption-close"]');

    act(() => {
      minBtn?.click();
    });
    expect(mockMinimize).toHaveBeenCalled();

    await act(async () => {
      maxBtn?.click();
    });
    expect(mockToggleMaximize).toHaveBeenCalled();

    act(() => {
      closeBtn?.click();
    });
    expect(mockClose).toHaveBeenCalled();
  });
});
