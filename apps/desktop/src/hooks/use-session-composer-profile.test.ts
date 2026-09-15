// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { HostServerMessage } from '@piwin/contracts';
import {
  sessionComposerPromptFields,
  useSessionComposerProfile,
  type SessionComposerProfileState,
} from './use-session-composer-profile.js';
import type { HostClient, HostClientListener } from '../host-client.js';
import type { ModelOption } from '../model-options.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const MODELS: ModelOption[] = [
  {
    providerId: 'openai',
    modelId: 'gpt-4o',
    label: 'openai / GPT-4o',
    source: 'channel',
  },
  {
    providerId: 'anthropic',
    protocol: 'anthropic-compatible',
    modelId: 'claude-sonnet',
    label: 'anthropic / Claude Sonnet',
    source: 'channel',
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high'],
  },
];

describe('sessionComposerPromptFields', () => {
  it('omits model when the picker key is empty', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: '',
        thinkingLevel: 'medium',
      }),
    ).toEqual({});
  });

  it('includes the selected model and skips thinking when the model has none', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: 'openai::gpt-4o',
        thinkingLevel: 'medium',
      }),
    ).toEqual({
      model: { providerId: 'openai', modelId: 'gpt-4o', source: 'channel' },
    });
  });

  it('includes thinking when the selected model supports it', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: 'anthropic::claude-sonnet',
        thinkingLevel: 'high',
      }),
    ).toEqual({
      model: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        protocol: 'anthropic-compatible',
        source: 'channel',
      },
      thinkingLevel: 'high',
    });
  });
});

describe('useSessionComposerProfile', () => {
  it('loads the model catalog once Host becomes ready after a failed first read', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const listeners = new Set<HostClientListener>();
    let hostReady = false;
    const hostClient = {
      subscribe: (listener: HostClientListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      request: async () =>
        hostReady
          ? {
              type: 'response',
              command: 'models/configured',
              success: true,
              data: {
                models: [
                  { providerId: 'openai', modelId: 'gpt-4o', protocol: 'openai-compatible' },
                ],
              },
            }
          : {
              type: 'response',
              command: 'models/configured',
              success: false,
              error: 'Host transport is not open',
            },
    } as unknown as HostClient;
    const latest: { current: SessionComposerProfileState | null } = { current: null };
    function Probe(): null {
      latest.current = useSessionComposerProfile({ hostClient, sessionId: 'session-pane' });
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(createElement(Probe)));
    expect(latest.current?.modelOptions).toHaveLength(0);

    hostReady = true;
    await act(async () => {
      for (const listener of listeners) {
        listener({ type: 'host/status', ready: true, mock: false } as HostServerMessage);
      }
    });

    expect(latest.current?.modelOptions.map((model) => model.modelId)).toEqual(['gpt-4o']);
    act(() => root.unmount());
  });
});
