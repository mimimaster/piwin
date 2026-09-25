// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { click, fakeHost, fakeHostContext, renderInkstone, type RenderedInkstone } from './test-host-fixture.js';

let rendered: RenderedInkstone | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

describe('InkstoneApp without a Host', () => {
  it('asks for a connection instead of showing sample sessions', () => {
    rendered = renderInkstone(null);
    expect(document.querySelector('.phone[data-route="sessions"]')).not.toBeNull();
    expect(document.body.textContent).toContain('需要连上 Host');
    expect(document.body.textContent).not.toContain('书房的 Mac Studio');
  });

  it('shows the connect prompt on chat, not a fake transcript', () => {
    rendered = renderInkstone(null, 'chat');
    expect(document.body.textContent).toContain('还没有连上 Host');
    expect(document.querySelector('.turn')).toBeNull();
  });
});

describe('InkstoneApp with a Host', () => {
  it('lists Host sessions with the list window and bottom nav', () => {
    rendered = renderInkstone(fakeHostContext());
    expect(document.body.textContent).toContain('修好移动端重连');
    expect(document.body.textContent).toContain('周末读书笔记');
    expect(document.querySelectorAll('.bottom-nav button').length).toBe(4);
  });

  it('navigates across the bottom nav without falling back to demo content', () => {
    rendered = renderInkstone(fakeHostContext());
    const tabs = () => document.querySelectorAll('.bottom-nav button');
    click(tabs()[1]);
    expect(document.querySelector('.phone[data-route="activity"]')).not.toBeNull();
    click(tabs()[2]);
    expect(document.querySelector('.phone[data-route="knowledge"]')).not.toBeNull();
    click(tabs()[3]);
    expect(document.querySelector('.phone[data-route="desk"]')).not.toBeNull();
    expect(document.body.textContent).toContain('127.0.0.1:8787');
  });

  it('shows no Live capsule when there is no Host call', () => {
    rendered = renderInkstone(fakeHostContext(), 'chat');
    expect(document.querySelector('.live-capsule')).toBeNull();
  });
});

describe('InkstoneApp on an offline snapshot', () => {
  it('shows the last synced list read-only and explains why rows do not open', () => {
    const opened: string[] = [];
    const host = fakeHost({
      connectionState: { kind: 'idle' },
      handleSelectSession: async (sessionId: string) => {
        opened.push(sessionId);
      },
    });
    rendered = renderInkstone({
      ...fakeHostContext(host),
      offlineSnapshot: { savedAt: new Date().toISOString() },
    });
    expect(document.querySelector('.offline-snapshot')?.textContent).toContain('离线快照');
    expect(document.body.textContent).toContain('修好移动端重连');
    click(document.querySelector('.session-open'));
    expect(opened).toEqual([]);
    expect(document.querySelector('.toast')?.textContent).toContain('连上 Host 后才能打开');
    expect(document.querySelector('.phone[data-route="sessions"]')).not.toBeNull();
  });
});
