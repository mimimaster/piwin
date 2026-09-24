// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SkillsPanel } from './SkillsPanel.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { PiwinUiProvider } from '@piwin/ui-kit';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function skillsRequestStub() {
  const fn = async (command: { type: string; projectPath?: string }) => {
    if (command.type === 'skills/list') {
      return {
        type: 'response' as const,
        command: 'skills/list',
        success: true,
        data: {
          skills: [
            {
              id: 'hatch-theme',
              name: 'hatch-theme',
              description: 'Hatch a theme',
              source: 'bundled',
              path: '/x/hatch-theme',
              enabled: true,
            },
            {
              id: 'imagegen',
              name: 'imagegen',
              description: 'Generate images',
              source: 'bundled',
              path: '/x/imagegen',
              enabled: true,
              hidden: true,
            },
            {
              id: 'my-notes',
              name: 'my-notes',
              description: 'Personal notes',
              source: 'user',
              path: '/x/my-notes',
              enabled: true,
            },
          ],
        },
      };
    }
    if (command.type === 'config/get') {
      return {
        type: 'response' as const,
        command: 'config/get',
        success: true,
        data: { config: { skills: { extraPaths: [], disabledIds: [] } } },
      };
    }
    return { type: 'response' as const, command: command.type, success: true, data: {} };
  };
  return fn as never;
}

function renderPanel(locale: 'en' | 'zh-CN' = 'en'): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale={locale} onLocaleChange={() => {}}>
          <SkillsPanel projectPath={null} request={skillsRequestStub()} variant="inline" />
        </DesktopLocaleProvider>
      </PiwinUiProvider> as ReactElement,
    );
  });
  return { container, root };
}

describe('SkillsPanel bundled skills', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('shows bundled skills with a built-in label and no toggle or remove', async () => {
    ({ root, container } = renderPanel());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const list = container!.querySelector('[data-testid="skills-list"]');
    expect(list).not.toBeNull();
    expect(container!.querySelector('[data-testid="skills-group-bundled"]')?.textContent).toContain(
      'bundled',
    );
    expect(container!.querySelector('[data-testid="skills-group-bundled"]')?.textContent).not.toContain(
      'Locked',
    );
    expect(container!.querySelector('[data-testid="skill-toggle-hatch-theme"]')).toBeNull();
    expect(container!.querySelector('[data-testid="skill-toggle-imagegen"]')).toBeNull();
    expect(container!.querySelector('[data-testid="skill-uninstall-hatch-theme"]')).toBeNull();
    expect(container!.querySelector('[data-testid="skill-uninstall-imagegen"]')).toBeNull();
    expect(container!.querySelector('[data-testid="skill-toggle-my-notes"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="skill-uninstall-my-notes"]')).not.toBeNull();
  });

  it('groups built-in skills separately from user-installed skills', async () => {
    ({ root, container } = renderPanel());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const bundled = container!.querySelector('[data-testid="skills-group-bundled"]');
    const user = container!.querySelector('[data-testid="skills-group-user"]');
    expect(bundled?.textContent).toContain('bundled');
    expect(bundled?.textContent).toContain('hatch-theme');
    expect(user?.textContent).toContain('Installed');
    expect(user?.textContent).toContain('my-notes');
    expect(bundled?.textContent).not.toContain('my-notes');
  });

  it('uses 应用内置 and Chinese catalog copy in zh-CN', async () => {
    ({ root, container } = renderPanel('zh-CN'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const bundled = container!.querySelector('[data-testid="skills-group-bundled"]');
    expect(bundled?.textContent).toContain('应用内置');
    expect(bundled?.textContent).toContain('位图');
    expect(bundled?.textContent).not.toContain('bundled');
  });
});

describe('SkillsPanel external path mapping', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  function statefulRequest() {
    let config = { skills: { extraPaths: [] as string[], disabledIds: [] as string[] } };
    const sent: Array<{ type: string; config?: typeof config }> = [];
    const fn = async (command: { type: string; config?: typeof config }) => {
      sent.push(command);
      if (command.type === 'config/get') {
        return { type: 'response' as const, command: 'config/get', success: true, data: { config } };
      }
      if (command.type === 'config/set' && command.config) {
        config = command.config;
        return { type: 'response' as const, command: 'config/set', success: true, data: {} };
      }
      if (command.type === 'skills/list') {
        return { type: 'response' as const, command: 'skills/list', success: true, data: { skills: [] } };
      }
      return { type: 'response' as const, command: command.type, success: true, data: {} };
    };
    return { request: fn as never, sent, current: () => config };
  }

  async function settle() {
    for (let index = 0; index < 6; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it('has no store tab and maps then unmaps a preset path', async () => {
    const state = statefulRequest();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SkillsPanel projectPath={null} request={state.request} variant="inline" />
          </DesktopLocaleProvider>
        </PiwinUiProvider> as ReactElement,
      );
    });
    await settle();
    expect(container.querySelector('[data-testid="skills-tab-store"]')).toBeNull();
    expect(container.querySelector('[data-testid="capability-discovery-hint-skill"]')).not.toBeNull();

    const button = () => container?.querySelector<HTMLButtonElement>('[data-testid="skill-map-claude"]');
    await act(async () => {
      button()?.click();
    });
    await settle();
    expect(state.current().skills.extraPaths).toEqual(['~/.claude/skills']);
    expect(button()?.textContent).toContain('click to unmap');

    await act(async () => {
      button()?.click();
    });
    await settle();
    expect(state.current().skills.extraPaths).toEqual([]);
    expect(button()?.textContent).toContain('Map Claude skills');
  });
});
