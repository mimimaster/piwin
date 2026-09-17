// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { CompactPromptComposer } from './compact-prompt-composer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('CompactPromptComposer', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('keeps the textarea clickable and exposes the shared model picker', () => {
    const onSend = vi.fn();
    const onSelectModel = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <CompactPromptComposer
            value=""
            onChange={() => undefined}
            placeholder="Ask about the context…"
            ariaLabel="Side chat input"
            testId="side-chat-input"
            sendLabel="Send"
            stopLabel="Stop"
            onSend={onSend}
            modelOptions={[
              {
                providerId: 'openai',
                modelId: 'gpt-4o',
                label: 'openai / GPT-4o',
              },
            ]}
            selectedModelKey="openai::gpt-4o"
            selectedModelLabel="openai / GPT-4o"
            thinkingLevel="off"
            onSelectModel={onSelectModel}
            onThinkingLevelChange={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="side-chat-input"]');
    expect(textarea).not.toBeNull();
    expect(textarea?.disabled).toBe(false);
    expect(container.querySelector('[data-testid="thinking-effort-trigger"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="compact-prompt-send"]')).not.toBeNull();
  });

  it('sends Enter immediately after IME Space confirmation', () => {
    const onSend = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <CompactPromptComposer
            value="你好"
            onChange={() => undefined}
            placeholder="Ask about the context…"
            ariaLabel="Side chat input"
            testId="side-chat-input"
            sendLabel="Send"
            stopLabel="Stop"
            onSend={onSend}
            modelOptions={[]}
            selectedModelKey=""
            selectedModelLabel=""
            thinkingLevel="off"
            onSelectModel={() => undefined}
            onThinkingLevelChange={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="side-chat-input"]');
    act(() => {
      textarea?.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      textarea?.dispatchEvent(new Event('compositionend', { bubbles: true }));
      textarea?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
