// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  createDefaultSubagentConfig,
  type OrchestrationSchemeSettings,
  type PiwinConfig,
} from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import type { SettingsContextValue } from '../settings-context';
import { buildOrchestrationCopy } from '../orchestration-copy';
import { SubagentProfilesPage } from './subagents-page';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let settings: SettingsContextValue;
vi.mock('../settings-context', () => ({ useSettings: () => settings }));
vi.mock('../../desktop-locale-context', () => ({ useDesktopLocale: () => ({ locale: 'zh-CN' }) }));

const LIGHT = { providerId: 'test', modelId: 'light', protocol: 'openai-compatible' as const };
function config(model = LIGHT): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'test',
        name: 'Test',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        models: [
          { id: 'light', label: 'Light' },
          { id: 'other', label: 'Other' },
        ],
      },
    ],
    subagents: { ...createDefaultSubagentConfig(), freehandReadonlyModel: model },
  } as PiwinConfig;
}

describe('freehand read-only subagent model settings', () => {
  let container: HTMLElement;
  let root: Root;
  let saves: PiwinConfig[];
  let quietSaves: boolean[];

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    saves = [];
    quietSaves = [];
    settings = {
      config: config(),
      saving: false,
      request: vi.fn(async () => ({
        id: 'configured',
        type: 'response' as const,
        command: 'models/configured',
        success: true as const,
        data: {
          models: [
            { ...LIGHT, source: 'channel', label: 'Light' },
            { ...LIGHT, modelId: 'other', source: 'channel', label: 'Other' },
          ],
        },
      })),
      saveConfig: vi.fn(async (next: PiwinConfig, options?: { quiet?: boolean }) => {
        saves.push(next);
        quietSaves.push(options?.quiet === true);
        return true;
      }),
      setError: vi.fn(),
      setInfo: vi.fn(),
    } as unknown as SettingsContextValue;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(reloaded = false): Promise<void> {
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentProfilesPage key={reloaded ? 'reloaded' : 'initial'} />
        </PiwinUiProvider>,
      );
    });
  }

  function picker(): HTMLSelectElement {
    const host = container.querySelector('[data-testid="freehand-readonly-model"]');
    const node = host instanceof HTMLSelectElement ? host : host?.querySelector('select');
    if (!(node instanceof HTMLSelectElement)) throw new Error('missing freehand model picker');
    return node;
  }

  it('loads a saved model and persists selection/inheritance without changing other subagent fields', async () => {
    await render();
    expect(picker().selectedOptions[0]?.textContent).toContain('Light');
    await act(async () => {
      picker().value =
        [...picker().options].find((option) => option.textContent?.endsWith('Other'))?.value ?? '';
      picker().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel?.modelId).toBe('other');
    expect(saves.at(-1)?.subagents?.maxConcurrency).toBe(4);
    settings = { ...settings, config: saves.at(-1) ?? null };
    await render(true);
    expect(picker().selectedOptions[0]?.textContent).toContain('Other');
    await act(async () => {
      picker().value = '';
      picker().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel).toBeUndefined();
  });

  it('keeps the selected freehand model when saving a scheme or global limits', async () => {
    await render();
    const clone = container.querySelector('[data-testid="orchestration-scheme-clone-ultra-code"]');
    if (!(clone instanceof HTMLElement)) throw new Error('missing clone');
    await act(async () => {
      clone.click();
    });
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel).toEqual(LIGHT);
    const advanced = container.querySelector('[data-testid="subagents-advanced-limits"]');
    const save = advanced?.querySelector('button');
    if (!(save instanceof HTMLElement)) throw new Error('missing limits save');
    await act(async () => {
      save.click();
    });
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel).toEqual(LIGHT);
  });

  function limitInput(rowTestId: string): HTMLInputElement {
    const input = container.querySelector(`[data-testid="${rowTestId}"] input`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`missing input in ${rowTestId}`);
    return input;
  }

  async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      // React tracks the value setter; assign through the prototype so onChange fires.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function saveLimits(): Promise<void> {
    const save = container.querySelector('[data-testid="subagents-advanced-limits"] button');
    if (!(save instanceof HTMLElement)) throw new Error('missing limits save');
    await act(async () => {
      save.click();
    });
  }

  it('saves the Auto Lead review limit, shows the default as a placeholder, and blank returns to default', async () => {
    await render();
    const files = limitInput('subagents-lead-review-files-row');
    const lines = limitInput('subagents-lead-review-lines-row');
    expect(files.value).toBe('');
    expect(files.placeholder).toBe('5');
    expect(lines.placeholder).toBe('300');

    await typeInto(files, '12');
    await typeInto(lines, '800');
    await saveLimits();
    expect(saves.at(-1)?.subagents?.leadReviewLimit).toEqual({ maxFiles: 12, maxChangedLines: 800 });

    // Out-of-range input is clamped to what the Host will actually use.
    await typeInto(files, '9999');
    await typeInto(lines, '1');
    await saveLimits();
    expect(saves.at(-1)?.subagents?.leadReviewLimit).toEqual({ maxFiles: 50, maxChangedLines: 10 });

    await typeInto(files, '');
    await typeInto(lines, '');
    await saveLimits();
    expect(saves.at(-1)?.subagents).not.toHaveProperty('leadReviewLimit');
  });

  it('shows a stored limit and keeps it when another setting is saved', async () => {
    settings = {
      ...settings,
      config: {
        ...config(),
        subagents: {
          ...createDefaultSubagentConfig(),
          freehandReadonlyModel: LIGHT,
          leadReviewLimit: { maxFiles: 9, maxChangedLines: 450 },
        },
      } as PiwinConfig,
    };
    await render();
    expect(limitInput('subagents-lead-review-files-row').value).toBe('9');
    expect(limitInput('subagents-lead-review-lines-row').value).toBe('450');
    const clone = container.querySelector('[data-testid="orchestration-scheme-clone-ultra-code"]');
    if (!(clone instanceof HTMLElement)) throw new Error('missing clone');
    await act(async () => {
      clone.click();
    });
    expect(saves.at(-1)?.subagents?.leadReviewLimit).toEqual({ maxFiles: 9, maxChangedLines: 450 });
  });

  it('offers inheritance with no configured models and labels the rule in both languages', async () => {
    settings = {
      ...settings,
      config: { ...config(), providers: [], subagents: createDefaultSubagentConfig() },
    };
    settings.request = vi.fn(async () => ({
      id: 'configured',
      type: 'response' as const,
      command: 'models/configured',
      success: true as const,
      data: { models: [] },
    }));
    await render();
    expect(picker().options).toHaveLength(1);
    expect(picker().options[0]?.textContent).toBe('继承主模型');
    expect(container.textContent).toContain('写入类子代理仍继承主模型');
    expect(buildOrchestrationCopy(false).freehandModelHint).toContain(
      'writing tasks inherit the main model',
    );
  });

  function schemeBox(schemeId: string): HTMLInputElement {
    const node = container.querySelector(
      `[data-testid="orchestration-scheme-default-${schemeId}"]`,
    );
    if (!(node instanceof HTMLInputElement)) throw new Error(`missing default box ${schemeId}`);
    return node;
  }

  async function clickBox(schemeId: string): Promise<void> {
    const box = schemeBox(schemeId);
    await act(async () => {
      box.click();
    });
  }

  it('checks one scheme as the default orchestration and can leave none checked', async () => {
    await render();
    expect(container.textContent).toContain('设为默认编排');
    expect(container.textContent).toContain('取消勾选后可以一个都不选');
    expect(schemeBox('fusion').checked).toBe(false);

    await clickBox('fusion');
    expect(saves.at(-1)?.desktop?.defaultOrchestrationSchemeId).toBe('fusion');
    expect(saves.at(-1)?.subagents).not.toHaveProperty('defaultSchemeId');
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel).toEqual(LIGHT);
    expect(quietSaves.at(-1)).toBe(true);
    expect(schemeBox('fusion').checked).toBe(true);
    expect(schemeBox('ultra-code').checked).toBe(false);

    await clickBox('ultra-code');
    expect(saves.at(-1)?.desktop?.defaultOrchestrationSchemeId).toBe('ultra-code');
    expect(quietSaves.at(-1)).toBe(true);
    expect(schemeBox('ultra-code').checked).toBe(true);
    expect(schemeBox('fusion').checked).toBe(false);

    await clickBox('ultra-code');
    expect(saves.at(-1)?.desktop?.defaultOrchestrationSchemeId).toBe('');
    expect(saves.at(-1)?.subagents).not.toHaveProperty('defaultSchemeId');
    expect(quietSaves.at(-1)).toBe(true);
    expect(schemeBox('ultra-code').checked).toBe(false);
    expect(schemeBox('fusion').checked).toBe(false);
  });

  it('clears the default orchestration when that custom scheme is deleted', async () => {
    const custom: OrchestrationSchemeSettings = {
      id: 'my-scheme-1',
      name: 'Temp',
      description: 'Custom roster',
      systemPreamble: 'Delegate to the roster.',
      exposeSpawnMetadata: false,
      waitPolicy: 'await-all',
      defaultRole: 'coder',
      members: [{ role: 'coder', description: 'Write the change', fallback: 'main' }],
    };
    settings = {
      ...settings,
      config: {
        ...config(),
        desktop: { defaultOrchestrationSchemeId: custom.id },
        subagents: {
          ...createDefaultSubagentConfig(),
          freehandReadonlyModel: LIGHT,
          schemes: [custom],
        },
      },
    };
    await render(true);
    expect(schemeBox(custom.id).checked).toBe(true);
    const remove = container.querySelector(
      `[data-testid="orchestration-scheme-delete-${custom.id}"]`,
    );
    if (!(remove instanceof HTMLElement)) throw new Error('missing delete');
    await act(async () => {
      remove.click();
    });
    const confirm = document.body.querySelector('[data-testid="confirm-dialog-confirm"]');
    if (!(confirm instanceof HTMLElement)) throw new Error('missing confirm');
    await act(async () => {
      confirm.click();
    });
    expect(saves.at(-1)?.desktop?.defaultOrchestrationSchemeId).toBe('');
    expect(saves.at(-1)?.subagents).not.toHaveProperty('defaultSchemeId');
    expect(
      saves.at(-1)?.subagents?.schemes?.some((scheme) => scheme.id === custom.id) ?? false,
    ).toBe(false);
    expect(saves.at(-1)?.subagents?.freehandReadonlyModel).toEqual(LIGHT);
  });
});
