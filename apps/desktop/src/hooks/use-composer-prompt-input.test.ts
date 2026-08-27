// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createInitialChatUiState } from '../chat-reducer';
import type { UseComposerMediaArgs } from './composer-media-args';
import {
  useComposerPromptInput,
  type ComposerPromptRequestInput,
} from './use-composer-prompt-input';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function readPromptInput(
  args: Partial<UseComposerMediaArgs>,
): ComposerPromptRequestInput {
  let built: ComposerPromptRequestInput | undefined;
  function Probe(): null {
    const { buildPromptRequestInput } = useComposerPromptInput({
      hostClient: { request: vi.fn(), subscribe: vi.fn() } as unknown as UseComposerMediaArgs['hostClient'],
      state: createInitialChatUiState(),
      dispatch: vi.fn(),
      agentMode: 'agent',
      ...args,
    });
    built = buildPromptRequestInput({ text: 'edit the file', agentMode: 'agent' });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(createElement(Probe));
  });
  if (built === undefined) {
    throw new Error('prompt input was not built');
  }
  return built;
}

describe('useComposerPromptInput permissionPreset', () => {
  it('sends composer Ask on project prompts so Host can gate tools', () => {
    const input = readPromptInput({ permissionPreset: 'ask' });
    expect(input.permissionPreset).toBe('ask');
    expect(input.agentMode).toBe('agent');
  });

  it('omits Run Mode on conversation chat', () => {
    const input = readPromptInput({ permissionPreset: 'ask', conversationChat: true });
    expect(input.permissionPreset).toBeUndefined();
    expect(input.agentMode).toBeUndefined();
  });

  it('resolves model from selectedModelKey when present', () => {
    const input = readPromptInput({
      selectedModelKey: 'openai::gpt-4o',
      modelOptions: [
        {
          protocol: 'openai-compatible',
          providerId: 'openai',
          modelId: 'gpt-4o',
        },
      ],
    });
    expect(input.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'openai',
      modelId: 'gpt-4o',
    });
  });

  it('falls back to promptModel when selectedModelKey is empty or unset', () => {
    const fallbackModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'google',
      modelId: 'gemini-3.7-flash',
    };
    const input = readPromptInput({
      selectedModelKey: '',
      promptModel: fallbackModel,
    });
    expect(input.model).toEqual(fallbackModel);
  });
});
