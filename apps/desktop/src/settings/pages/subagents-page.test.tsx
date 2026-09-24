// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createDefaultSubagentConfig, type PiwinConfig } from '@piwin/contracts';
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

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    saves = [];
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
      saveConfig: vi.fn(async (next: PiwinConfig) => {
        saves.push(next);
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
});
