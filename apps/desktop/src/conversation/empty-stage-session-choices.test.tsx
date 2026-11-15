// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { draftAgentOptionsFrom } from '../hooks/use-backend-session-controls.js';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { EmptyStageSessionChoices } from './empty-stage-session-choices.js';

describe('session entry readiness guidance', () => {
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

  it.each([
    { locale: 'zh-CN' as const, badge: '插件校验失败', action: '查看修复方法', detail: '重新安装' },
    { locale: 'en' as const, badge: 'Plugin Check Failed', action: 'View repair steps', detail: 'Reinstall' },
  ])('shows the integrity problem and recovery route in $locale', ({ locale, badge, action, detail }) => {
    const onOpenAgentSettings = vi.fn();
    const onSelectDraftAgent = vi.fn();
    const options = draftAgentOptionsFrom([
      { agentId: 'antigravity', state: 'unavailable', reason: 'agent-artifact-integrity' },
    ], [{ agentId: 'antigravity', name: 'Antigravity', description: 'Agent description' }]);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <EmptyStageSessionChoices
            locale={locale}
            draftAgentOptions={options}
            onOpenAgentSettings={onOpenAgentSettings}
            onSelectDraftAgent={onSelectDraftAgent}
          />
        </PiwinUiProvider>,
      );
    });

    const card = container.querySelector('[data-testid="empty-stage-engine-antigravity"]');
    expect(card?.textContent).toContain(badge);
    expect(card?.textContent).toContain(action);
    expect(card?.getAttribute('title')).toContain(detail);
    expect(card?.textContent).not.toContain('配置环境');
    const recovery = card?.querySelector('.empty-stage-engine-settings-link');
    act(() => recovery?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onOpenAgentSettings).toHaveBeenCalledOnce();
    expect(onSelectDraftAgent).not.toHaveBeenCalled();
  });
});
