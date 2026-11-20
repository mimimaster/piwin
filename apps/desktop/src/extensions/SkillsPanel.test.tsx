// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SkillsPanel } from './SkillsPanel.js';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context.js';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
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

describe('SkillsPanel mapped skill cleanup and restore', () => {
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

  async function settle() {
    for (let index = 0; index < 8; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function createMappedHostState(initial?: {
    extraPaths?: string[];
    disabledIds?: string[];
    excludedIds?: string[];
  }) {
    let config: {
      skills: {
        extraPaths: string[];
        disabledIds: string[];
        excludedIds?: string[];
      };
    } = {
      skills: {
        extraPaths: initial?.extraPaths ?? ['~/.agents/skills'],
        disabledIds: initial?.disabledIds ?? ['aws-cdk', 'aws-auth', 'amazon-bedrock'],
        ...(initial?.excludedIds ? { excludedIds: initial.excludedIds } : {}),
      },
    };
    const allMapped = [
      {
        id: 'amazon-bedrock',
        name: 'amazon-bedrock',
        description: 'Bedrock skills',
        source: 'mapped' as const,
        path: '/Users/test/.agents/skills/amazon-bedrock',
        mappedFrom: '~/.agents/skills',
      },
      {
        id: 'aws-auth',
        name: 'aws-auth',
        description: 'AWS Auth',
        source: 'mapped' as const,
        path: '/Users/test/.agents/skills/aws-auth',
        mappedFrom: '~/.agents/skills',
      },
      {
        id: 'aws-cdk',
        name: 'aws-cdk',
        description: 'AWS CDK',
        source: 'mapped' as const,
        path: '/Users/test/.agents/skills/aws-cdk',
        mappedFrom: '~/.agents/skills',
      },
      {
        id: 'useful-skill',
        name: 'useful-skill',
        description: 'Keep this useful skill',
        source: 'mapped' as const,
        path: '/Users/test/.agents/skills/useful-skill',
        mappedFrom: '~/.agents/skills',
      },
    ];

    const request = async (command: { type: string; config?: typeof config }) => {
      if (command.type === 'config/get') {
        return { type: 'response' as const, command: 'config/get', success: true, data: { config } };
      }
      if (command.type === 'config/set' && command.config) {
        config = command.config;
        return { type: 'response' as const, command: 'config/set', success: true, data: {} };
      }
      if (command.type === 'skills/list') {
        const excluded = new Set((config.skills.excludedIds ?? []).map((id) => id.toLowerCase()));
        const disabled = new Set(config.skills.disabledIds.map((id) => id.toLowerCase()));
        const extraPaths = new Set(config.skills.extraPaths);
        const skills = allMapped
          .filter((entry) => extraPaths.has(entry.mappedFrom) && !excluded.has(entry.id))
          .map((entry) => ({ ...entry, enabled: !disabled.has(entry.id) }));
        return { type: 'response' as const, command: 'skills/list', success: true, data: { skills } };
      }
      return { type: 'response' as const, command: command.type, success: true, data: {} };
    };

    return { request: request as never, current: () => config };
  }

  function renderWithState(request: never, locale: 'en' | 'zh-CN' = 'zh-CN') {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale={locale} onLocaleChange={() => {}}>
            <SkillsPanel projectPath={null} request={request} variant="inline" />
          </DesktopLocaleProvider>
        </PiwinUiProvider> as ReactElement,
      );
    });
  }

  it('removes a single mapped skill and allows restoring it from the excluded tray', async () => {
    const state = createMappedHostState();
    renderWithState(state.request);
    await settle();

    const removeBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="skill-exclude-amazon-bedrock"]',
    );
    expect(removeBtn).not.toBeNull();
    await act(async () => {
      removeBtn?.click();
    });
    await settle();

    expect(state.current().skills.excludedIds).toEqual(['amazon-bedrock']);
    expect(container!.querySelector('[data-testid="skill-exclude-amazon-bedrock"]')).toBeNull();
    expect(container!.querySelector('[data-testid="mapped-excluded-tray"]')?.textContent).toContain(
      '已屏蔽 1 个映射技能',
    );

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="mapped-excluded-toggle"]')?.click();
    });
    await settle();
    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="mapped-restore-amazon-bedrock"]')
        ?.click();
    });
    await settle();

    expect(state.current().skills.excludedIds).toBeUndefined();
    expect(container!.querySelector('[data-testid="skill-exclude-amazon-bedrock"]')).not.toBeNull();
  });

  it('removes all disabled mapped skills in one click while keeping enabled mapped skills', async () => {
    const state = createMappedHostState();
    renderWithState(state.request);
    await settle();

    const cleanupBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="mapped-exclude-disabled"]',
    );
    expect(cleanupBtn?.textContent).toContain('清理未启用 (3)');

    await act(async () => {
      cleanupBtn?.click();
    });
    await settle();

    expect(state.current().skills.excludedIds).toEqual(['amazon-bedrock', 'aws-auth', 'aws-cdk']);
    expect(container!.querySelector('[data-testid="skill-exclude-useful-skill"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="skill-exclude-aws-cdk"]')).toBeNull();

    await act(async () => {
      container!
        .querySelector<HTMLButtonElement>('[data-testid="mapped-excluded-restore-all"]')
        ?.click();
    });
    await settle();
    expect(state.current().skills.excludedIds).toBeUndefined();
    expect(container!.querySelector('[data-testid="skill-exclude-aws-cdk"]')).not.toBeNull();
  });

  it('removes matching mapped skills when search filter is active', async () => {
    const state = createMappedHostState();
    renderWithState(state.request);
    await settle();

    const filterInput = container!.querySelector<HTMLInputElement>('[data-testid="skills-filter"]');
    expect(filterInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(filterInput, 'aws');
      filterInput?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle();

    const removeFiltered = container!.querySelector<HTMLButtonElement>(
      '[data-testid="mapped-exclude-filtered"]',
    );
    expect(removeFiltered?.textContent).toContain('移除匹配项 (2)');
    await act(async () => {
      removeFiltered?.click();
    });
    await settle();

    expect(state.current().skills.excludedIds).toEqual(['aws-auth', 'aws-cdk']);
    expect(container!.querySelector('[data-testid="skill-exclude-aws-cdk"]')).toBeNull();
  });

  it('supports batch selection mode and unmapping custom non-preset paths', async () => {
    const state = createMappedHostState({
      extraPaths: ['~/.agents/skills', '/opt/team/skills'],
    });
    renderWithState(state.request);
    await settle();

    const customBtn = container!.querySelector<HTMLButtonElement>(
      '[data-testid="skill-map-custom-0"]',
    );
    expect(customBtn?.textContent).toContain('/opt/team/skills');

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="mapped-batch-toggle"]')?.click();
    });
    await settle();

    await act(async () => {
      container!.querySelector<HTMLInputElement>('[data-testid="mapped-select-aws-auth"]')?.click();
      container!.querySelector<HTMLInputElement>('[data-testid="mapped-select-aws-cdk"]')?.click();
    });
    await settle();

    const batchRemove = container!.querySelector<HTMLButtonElement>(
      '[data-testid="mapped-batch-remove"]',
    );
    expect(batchRemove?.textContent).toContain('移除选中 (2)');
    await act(async () => {
      batchRemove?.click();
    });
    await settle();

    expect(state.current().skills.excludedIds).toEqual(['aws-auth', 'aws-cdk']);

    await act(async () => {
      customBtn?.click();
    });
    await settle();
    expect(state.current().skills.extraPaths).toEqual(['~/.agents/skills']);
  });
});
