import { describe, expect, it, vi } from 'vitest';
import { buildSideChatComposerProps } from './side-chat-composer-props.js';

describe('buildSideChatComposerProps', () => {
  it('reuses ComposerCard as an embedded conversation slab', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const props = buildSideChatComposerProps({
      composer: 'hello',
      onComposerChange: vi.fn(),
      streaming: false,
      activeSideChatId: null,
      mainSessionReady: true,
      modelOptions: [],
      selectedModelKey: 'openai::gpt-4o',
      selectedModelLabel: 'GPT-4o',
      thinkingLevel: 'off',
      onSelectModel: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend,
      onStop,
    });
    expect(props.embedded).toBe(true);
    expect(props.isConversationSession).toBe(true);
    expect(props.layoutMode).toBe('docked');
    expect(props.mutationsEnabled).toBe(true);
    expect(props.onAbort).toBe(onStop);
    expect(props.onPause).toBe(onStop);
  });

  it('marks a live run as streaming so the action slot can show Stop', () => {
    const props = buildSideChatComposerProps({
      composer: '',
      onComposerChange: vi.fn(),
      streaming: true,
      activeSideChatId: 'side-1',
      mainSessionReady: true,
      modelOptions: [],
      selectedModelKey: 'openai::gpt-4o',
      selectedModelLabel: 'GPT-4o',
      thinkingLevel: 'off',
      onSelectModel: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
    });
    expect(props.streaming).toBe(true);
    expect(props.runPhase).toBe('streaming');
    expect(props.activeSessionId).toBe('side-1');
  });
});
