// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { click, fakeHost, fakeHostContext, renderInkstone, type RenderedInkstone } from './test-host-fixture.js';
import { SESSION_MODE_STORAGE_KEY } from './session-mode.js';

let rendered: RenderedInkstone | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  localStorage.removeItem(SESSION_MODE_STORAGE_KEY);
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
    expect(sessionTitles()).toEqual(['周末读书笔记']);
    expect(document.querySelectorAll('.bottom-nav button').length).toBe(4);
  });

  it('splits conversations from Agent sessions and remembers the choice', () => {
    rendered = renderInkstone(fakeHostContext());
    click(segment('Agent'));
    expect(sessionTitles()).toEqual(['修好移动端重连']);
    expect(localStorage.getItem(SESSION_MODE_STORAGE_KEY)).toBe('agent');
    click(segment('对话'));
    expect(sessionTitles()).toEqual(['周末读书笔记']);
  });

  it('opens a blank conversation from + without a form', () => {
    const created: Array<string | undefined> = [];
    const host = fakeHost({
      handleCreateSession: async (projectId?: string) => {
        created.push(projectId);
        return undefined;
      },
    });
    rendered = renderInkstone(fakeHostContext(host));
    click(document.querySelector('[aria-label="新对话"]'));
    expect(document.querySelector('.phone[data-route="chat"]')).not.toBeNull();
    expect(document.querySelector('.draft-empty')).not.toBeNull();
    expect(document.querySelector('select')).toBeNull();
    expect(document.querySelector('.dock-chips')).toBeNull();

    typeMessage('今晚吃什么');
    click(document.querySelector('[aria-label="发送消息"]'));
    expect(created).toEqual([undefined]);
  });

  it('starts an Agent draft in the most recent project', () => {
    const created: Array<string | undefined> = [];
    const host = fakeHost({
      handleCreateSession: async (projectId?: string) => {
        created.push(projectId);
        return undefined;
      },
    });
    rendered = renderInkstone(fakeHostContext(host));
    click(segment('Agent'));
    click(document.querySelector('[aria-label="新建 Agent 会话"]'));
    expect(document.querySelector('.dock-chip')?.textContent).toContain('piwin');

    typeMessage('审阅最近的变更');
    click(document.querySelector('[aria-label="发送消息"]'));
    expect(created).toEqual(['p1']);
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

  it('highlights 动态 in the bottom nav on the activity page', () => {
    rendered = renderInkstone(fakeHostContext(), 'activity');
    expect(document.querySelector('.bottom-nav button.active')?.textContent).toContain('动态');
    expect(document.querySelector('.notice-strip')).toBeNull();
  });

  it('keeps finished sessions free of status dots and filler subtitles', () => {
    rendered = renderInkstone(fakeHostContext());
    expect(document.querySelectorAll('.session-item > .dot')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('条消息');
    expect(document.querySelector('.host-card')).toBeNull();
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
    expect(document.body.textContent).toContain('周末读书笔记');
    click(document.querySelector('.session-open'));
    expect(opened).toEqual([]);
    expect(document.querySelector('.toast')?.textContent).toContain('连上 Host 后才能打开');
    expect(document.querySelector('.phone[data-route="sessions"]')).not.toBeNull();
  });
});

function sessionTitles(): string[] {
  return [...document.querySelectorAll('.session-open strong')].map((node) => node.textContent ?? '');
}

function segment(label: string): Element | undefined {
  return [...document.querySelectorAll('.segmented button')].find((node) => node.textContent === label);
}

function typeMessage(text: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息内容"]');
  if (textarea === null) throw new Error('composer textarea missing');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
