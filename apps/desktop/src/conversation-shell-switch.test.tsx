// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ConversationShellSwitch } from './conversation-shell-switch.js';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('titlebar Desktop / CLI switch', () => {
  it('uses icon-only cells, announces the selected shell and switches once', () => {
    const onDesktop = vi.fn(); const onCli = vi.fn();
    const render = (cli: boolean) => act(() => root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ConversationShellSwitch cli={cli} locale="zh-CN" appearanceMode="dark" onDesktop={onDesktop} onCli={onCli} />
    </PiwinUiProvider>));
    render(false);
    const desktop = container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-desktop"]');
    const cli = container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]');
    expect(desktop?.querySelector('svg')).not.toBeNull();
    expect(desktop?.textContent).toBe('');
    expect(cli?.querySelector('svg')).not.toBeNull();
    expect(cli?.textContent).toBe('');
    expect(desktop?.getAttribute('aria-pressed')).toBe('true');
    act(() => desktop?.click()); expect(onDesktop).not.toHaveBeenCalled();
    act(() => cli?.click()); expect(onCli).toHaveBeenCalledOnce();
    render(true);
    expect(cli?.getAttribute('aria-pressed')).toBe('true');
    act(() => cli?.click()); expect(onCli).toHaveBeenCalledOnce();
    act(() => desktop?.click()); expect(onDesktop).toHaveBeenCalledOnce();
  });
});

it('warms on keyboard intent and allows CLI selection while history is syncing', () => {
  const onCli = vi.fn();
  const onCliIntent = vi.fn();
  act(() => root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
    <ConversationShellSwitch cli={false} busy locale="zh-CN" appearanceMode="dark"
      onDesktop={() => undefined} onCli={onCli} onCliIntent={onCliIntent} />
  </PiwinUiProvider>));
  const button = container.querySelector<HTMLButtonElement>('[data-testid="conversation-shell-cli"]');
  if (button === null) throw new Error('CLI missing');
  act(() => button.focus());
  expect(onCliIntent).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(onCli).toHaveBeenCalledOnce();
});
