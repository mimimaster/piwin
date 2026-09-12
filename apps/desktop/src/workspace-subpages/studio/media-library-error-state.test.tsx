// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaLibraryErrorState } from './media-library-error-state';

describe('MediaLibraryErrorState', () => {
  let container: HTMLElement;
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

  it('renders friendly teardown error screen with reconnect action', () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <MediaLibraryErrorState
          error="Host transport is not open"
          isTeardown={true}
          onRetry={onRetry}
          onClose={onClose}
          locale="zh-CN"
        />,
      );
    });

    const errorCard = container.querySelector('[data-testid="library-error-state"]');
    expect(errorCard).not.toBeNull();
    expect(container.querySelector('.lib-state-title')?.textContent).toBe('Host 服务尚未连接');
    expect(container.textContent).toContain('连接等待中');
    expect(container.textContent).toContain('与 Host 服务的连接正在建立或已中断');

    const retryBtn = container.querySelector<HTMLButtonElement>('[data-testid="library-error-retry"]');
    expect(retryBtn).not.toBeNull();
    act(() => {
      retryBtn?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="library-error-back"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders generic failure screen when host returns an unhandled error', () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <MediaLibraryErrorState
          error="Host 还是旧进程。请完全退出桌面应用再打开，不要只刷新窗口。"
          isTeardown={false}
          onRetry={onRetry}
          onClose={onClose}
          locale="zh-CN"
        />,
      );
    });

    expect(container.querySelector('.lib-state-title')?.textContent).toBe('无法加载资料库');
    expect(container.textContent).toContain('Host 还是旧进程');
  });
});
