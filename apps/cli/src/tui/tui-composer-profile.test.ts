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

async function loadedProfile(config: Record<string, unknown>) {
  const request = async (command: HostCommand): Promise<HostResponse> => ({
    type: 'response',
    command: command.type,
    success: true,
    data: command.type === 'models/configured' ? { models: MODELS } : { config },
  });
  const modals = new FakeModals();
  const profile = new TuiComposerProfile({
    link: { request } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    getSessionId: () => 's1',
    onChanged: vi.fn(),
    onHint: vi.fn(),
    onError: vi.fn(),
  });
  await profile.loadModels();
  await profile.loadHostPermissionPreset();
  return { profile, modals };
}

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
