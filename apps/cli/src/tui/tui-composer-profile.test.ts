import type { Component } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TuiComposerProfile } from './tui-composer-profile.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

const MODELS = [
  { providerId: 'xai', modelId: 'grok-4.6', label: 'Grok 4.6', providerName: 'Grok' },
  { providerId: 'xai', modelId: 'grok-4.5', label: 'Grok 4.5', providerName: 'Grok' },
];

class FakeModals {
  public current: Component | undefined;
  public show(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public text(): string {
    return (this.current?.render(80) ?? []).join('\n');
  }
}

async function loadedProfile(config: Record<string, unknown>, agentId?: string) {
  const request = async (command: HostCommand): Promise<HostResponse> => ({
    type: 'response',
    command: command.type,
    success: true,
    data: command.type === 'models/configured' ? { models: MODELS } : { config },
  });
  const modals = new FakeModals();
  const onHint = vi.fn();
  const profile = new TuiComposerProfile({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    getSessionId: () => 's1',
    getAgentId: () => agentId,
    onChanged: vi.fn(),
    onHint,
    onError: vi.fn(),
  });
  await profile.loadModels();
  await profile.loadHostPermissionPreset();
  return { profile, modals, onHint };
}

describe('TuiComposerProfile on an external agent session', () => {
  it('leaves model and thinking to the agent and says so', async () => {
    const { profile, modals, onHint } = await loadedProfile({}, 'grok');
    profile.openModelPicker();
    profile.openThinkingPicker();
    profile.openPermissionPicker();
    profile.cyclePermissionPreset();
    expect(modals.current).toBeUndefined();
    expect(onHint).toHaveBeenCalledWith('「grok」会话的模型由该 agent 自己管理，这里不能改');
    expect(onHint).toHaveBeenCalledWith('「grok」会话的思考强度由该 agent 自己管理，这里不能改');
    expect(onHint).toHaveBeenCalledWith('「grok」会话的权限模式由该 agent 自己管理，这里不能改');
  });
});

describe('TuiComposerProfile default model', () => {
  it('names the Host default instead of a generic label', async () => {
    const { profile } = await loadedProfile({ defaultProviderId: 'xai', defaultModelId: 'grok-4.5' });
    expect(profile.describe()[0]).toBe('Grok 4.5（默认）');
  });

  it('starts the model picker on the Host default, not on the first model', async () => {
    const { profile, modals } = await loadedProfile({ defaultProviderId: 'xai', defaultModelId: 'grok-4.5' });
    profile.openModelPicker();
    const selected = modals.text().split('\n').find((line) => line.includes('→'));
    expect(selected).toContain('Grok 4.5');
  });

  it('keeps the generic label when the Host default is not one of its listed models', async () => {
    const { profile } = await loadedProfile({ defaultProviderId: 'gone', defaultModelId: 'missing' });
    expect(profile.describe()[0]).toBe('默认模型');
  });
});


describe('TUI profile arriving after resume', () => {
  it('fills in the selected session model label when the catalog finally arrives', async () => {
    const request = async (command: HostCommand): Promise<HostResponse> => ({
      type: 'response', command: command.type, success: true, data: { models: MODELS },
    });
    const profile = new TuiComposerProfile({
      link: { request } as unknown as TuiHostLink, modals: new FakeModals() as unknown as TuiModalStack,
      getSessionId: () => 's1', getAgentId: () => undefined,
      onChanged: vi.fn(), onHint: vi.fn(), onError: vi.fn(),
    });
    profile.adoptSessionModel({ providerId: 'xai', modelId: 'grok-4.5' });
    await profile.loadModels();
    expect(profile.describe()[0]).toBe('Grok 4.5');
    expect(profile.modelRef()).toEqual({ providerId: 'xai', modelId: 'grok-4.5' });
  });
});

describe('TuiComposerProfile orchestration scheme', () => {
  const USER_SCHEME = { id: 'mine', name: '我的方案', description: '自己的编排', systemPreamble: '先调研' };
  const UP = '\x1b[A';
  const DOWN = '\x1b[B';

  it('starts freehand, sends that on every prompt, and shows no badge', async () => {
    const { profile } = await loadedProfile({});
    expect(profile.activeSchemeName()).toBeUndefined();
    expect(profile.describe()[4]).toBeUndefined();
    expect(profile.promptFields()).toMatchObject({ orchestrationSchemeId: 'off', delegationMode: 'auto' });
  });

  it('starts a new session from the configured default scheme', async () => {
    const { profile } = await loadedProfile({ subagents: { defaultSchemeId: 'ultra-code' } });
    expect(profile.activeSchemeName()).toBe('Ultra Code');
    expect(profile.describe()[4]).toBe('编排 Ultra Code');
    expect(profile.promptFields()).toMatchObject({ orchestrationSchemeId: 'ultra-code', delegationMode: 'auto' });
  });

  it('lists user schemes in the picker and keeps a choice until the session changes', async () => {
    const { profile, modals } = await loadedProfile({ subagents: { schemes: [USER_SCHEME] } });
    profile.openSchemePicker();
    expect(modals.text()).toContain('我的方案');
    expect(modals.text()).toContain('不使用子代理');
    modals.current?.handleInput?.(DOWN);
    modals.current?.handleInput?.('\r');
    expect(profile.activeSchemeName()).toBe('Ultra Code');
    expect(profile.promptFields().orchestrationSchemeId).toBe('ultra-code');
    profile.resetSchemeForNewSession();
    expect(profile.activeSchemeName()).toBeUndefined();
  });

  it('turns subagents off for the session', async () => {
    const { profile, modals } = await loadedProfile({ subagents: { defaultSchemeId: 'ultra-code' } });
    profile.openSchemePicker();
    // From Ultra Code, up twice wraps past 自由 to the last entry.
    modals.current?.handleInput?.(UP);
    modals.current?.handleInput?.(UP);
    modals.current?.handleInput?.('\r');
    expect(profile.activeSchemeName()).toBeUndefined();
    expect(profile.describe()[4]).toBe('子代理 关');
    expect(profile.promptFields()).toMatchObject({ orchestrationSchemeId: 'off', delegationMode: 'disabled' });
  });

  it('leaves schemes out for an external agent', async () => {
    const { profile, onHint } = await loadedProfile({ subagents: { defaultSchemeId: 'ultra-code' } }, 'grok');
    expect(profile.promptFields()).not.toHaveProperty('orchestrationSchemeId');
    profile.openSchemePicker();
    expect(onHint).toHaveBeenCalledWith('「grok」会话的子代理编排由该 agent 自己管理，这里不能改');
  });
});
