// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { MOBILE_THEME } from '../mobile-theme.js';
import { InkstoneApp } from './InkstoneApp.js';

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

function renderApp(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <PiwinUiProvider manifest={MOBILE_THEME}>
        <InkstoneApp hostContext={null} />
      </PiwinUiProvider>,
    );
  });
}

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  window.location.hash = '';
});

describe('InkstoneApp smoke', () => {
  it('renders the sessions screen with continue card and bottom nav', () => {
    renderApp();
    expect(document.querySelector('.phone[data-route="sessions"]')).not.toBeNull();
    expect(document.body.textContent).toContain('桌面上正在进行');
    expect(document.body.textContent).toContain('书房的 Mac Studio');
    expect(document.querySelectorAll('.bottom-nav button').length).toBe(4);
  });

  it('opens the chat through the continue card and shows the composer', () => {
    renderApp();
    const continueButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('接着看'),
    );
    expect(continueButton).toBeDefined();
    act(() => {
      continueButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="chat"]')).not.toBeNull();
    expect(document.querySelector('.composer textarea')).not.toBeNull();
  });

  it('opens and closes the model bottom sheet', () => {
    renderApp();
    act(() => {
      window.history.pushState(null, '', '#chat');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const modelButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Claude Sonnet'),
    );
    expect(modelButton).toBeDefined();
    act(() => {
      modelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(true);
    expect(document.querySelector('.sheet-head h2')?.textContent).toBe('模型与思考');

    const closeButton = [...document.querySelectorAll('dialog button')].find((button) =>
      button.getAttribute('aria-label')?.includes('关闭弹层'),
    );
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(false);
  });

  it('supports dual-pane switching between 对话 and 项目 on sessions', () => {
    renderApp();
    const chatTab = [...document.querySelectorAll('.segmented button')].find((button) =>
      button.textContent?.includes('对话'),
    );
    expect(chatTab).toBeDefined();
    act(() => {
      chatTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('润色一封英文邮件');
    expect(document.body.textContent).toContain('周末读书笔记');

    const projectTab = [...document.querySelectorAll('.segmented button')].find((button) =>
      button.textContent?.includes('项目'),
    );
    act(() => {
      projectTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.body.textContent).toContain('piwin');
    expect(document.body.textContent).toContain('piwin-docs');
  });

  it('navigates across the 4 bottom-nav tabs: sessions, activity, knowledge, desk', () => {
    renderApp();
    expect(document.querySelectorAll('.bottom-nav button').length).toBe(4);

    // Navigate to activity
    act(() => {
      document.querySelectorAll('.bottom-nav button')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="activity"]')).not.toBeNull();
    expect(document.body.textContent).toContain('等你，一方印。');

    // Navigate to knowledge
    act(() => {
      document.querySelectorAll('.bottom-nav button')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="knowledge"]')).not.toBeNull();
    expect(document.body.textContent).toContain('留下的，皆成学问。');

    // Navigate to desk
    act(() => {
      document.querySelectorAll('.bottom-nav button')[3]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="desk"]')).not.toBeNull();
    expect(document.body.textContent).toContain('一方小案头。');
  });

  it('renders live-capsule when liveMini is active and expands back', () => {
    renderApp();
    act(() => {
      window.history.pushState(null, '', '#voice');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(document.querySelector('.phone[data-route="voice"]')).not.toBeNull();

    const pipButton = document.querySelector('button[aria-label="收缩为小部件"]');
    expect(pipButton).toBeDefined();
    act(() => {
      pipButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Now routed to chat and floating live capsule is present
    expect(document.querySelector('.phone[data-route="chat"]')).not.toBeNull();
    expect(document.querySelector('.live-capsule')).not.toBeNull();
    expect(document.body.textContent).toContain('Live · 我在听');

    // Clicking capsule body expands back to voice
    const capsuleBody = document.querySelector('.capsule-body');
    act(() => {
      capsuleBody?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('.phone[data-route="voice"]')).not.toBeNull();
  });
});
