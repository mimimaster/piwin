// @vitest-environment happy-dom
import { act, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../platform/webview-inspection.js', () => ({ requestWebviewInspection: native.request }));
vi.mock('@piwin/ui-kit', () => ({
  Button: ({ children, onClick, disabled }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Card: ({ children, testId }: { children?: ReactNode; testId?: string }) => (
    <section data-testid={testId}>{children}</section>
  ),
}));
vi.mock('./memory-diagnostics-parts.js', () => ({
  MemoryDiagNote: ({ children, testId }: { children?: ReactNode; testId?: string }) => (
    <p data-testid={testId}>{children}</p>
  ),
}));
import { MemoryInspectionControls } from './MemoryInspectionControls.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  native.request.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

async function render(): Promise<void> {
  await act(async () => { root.render(<MemoryInspectionControls locale="zh-CN" />); });
}

async function click(): Promise<void> {
  const button = container.querySelector('button');
  if (button === null) throw new Error('missing inspection control');
  await act(async () => { button.click(); });
}

describe('on-demand page inspection controls', () => {
  it('only enables inspection after a click, explains Safari, and permits disabling it again', async () => {
    native.request.mockResolvedValueOnce({ supported: true, enabled: false })
      .mockResolvedValueOnce({ supported: true, enabled: true })
      .mockResolvedValueOnce({ supported: true, enabled: false });
    await render();
    expect(native.request).toHaveBeenCalledExactlyOnceWith();
    expect(container.textContent).toContain('启用页面检查');
    await click();
    expect(native.request).toHaveBeenNthCalledWith(2, true);
    expect(container.textContent).toContain('关闭页面检查');
    expect(container.textContent).toContain('Safari 的「开发」菜单');
    await click();
    expect(native.request).toHaveBeenNthCalledWith(3, false);
    expect(container.textContent).toContain('启用页面检查');
  });

  it('reads an already enabled native view rather than guessing from local UI state', async () => {
    native.request.mockResolvedValue({ supported: true, enabled: true });
    await render();
    expect(container.textContent).toContain('关闭页面检查');
    expect(native.request).toHaveBeenCalledExactlyOnceWith();
  });

  it('hides the action when the platform does not support inspection', async () => {
    native.request.mockResolvedValue({ supported: false, enabled: false });
    await render();
    expect(container.childElementCount).toBe(0);
  });

  it('reports an unconfirmed opt-in and retries with a read-only query', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    native.request.mockResolvedValueOnce({ supported: true, enabled: false })
      .mockRejectedValueOnce(new Error('native view unavailable'))
      .mockResolvedValueOnce({ supported: true, enabled: false });
    await render();
    await click();
    expect(container.textContent).toContain('重新连接检查工具');
    expect(container.textContent).not.toContain('关闭页面检查');
    expect(container.textContent).toContain('连接检查工具失败');
    await click();
    expect(native.request).toHaveBeenNthCalledWith(3, undefined);
    expect(container.textContent).toContain('启用页面检查');
  });
});
