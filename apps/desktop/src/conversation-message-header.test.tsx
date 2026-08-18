// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContextUsageSnapshot, ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import {
  buildConversationTurnUsageChip,
  ConversationMessageHeader,
} from './conversation-message-header';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ConversationMessageHeader', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseMessage: ChatMessageUi = {
    id: 'msg-assistant-1',
    role: 'assistant',
    text: 'Hello, how can I help you?',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    createdAt: '2026-08-18T14:15:00.000Z',
  };

  const model: ModelRef = {
    protocol: 'anthropic-compatible',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4',
  };

  it('renders provider icon, model name, provider name, and formatted time', () => {
    act(() => {
      root.render(
        <ConversationMessageHeader
          message={baseMessage}
          model={model}
          shortModelName="claude-sonnet-4"
          modelLabel="Claude 3.7 Sonnet"
          providerName="Anthropic"
        />,
      );
    });

    const header = container.querySelector('[data-testid="conversation-message-header"]');
    expect(header).not.toBeNull();

    const providerIcon = container.querySelector('.conversation-message-provider-icon');
    expect(providerIcon).not.toBeNull();

    const modelName = container.querySelector('[data-testid="conversation-message-model-name"]');
    expect(modelName?.textContent).toBe('claude-sonnet-4');

    const providerName = container.querySelector(
      '[data-testid="conversation-message-provider-name"]',
    );
    expect(providerName?.textContent).toBe('Anthropic');

    const time = container.querySelector('[data-testid="conversation-message-time"]');
    expect(time).not.toBeNull();
  });

  it('renders only timestamp when model snapshot is absent (legacy rows)', () => {
    act(() => {
      root.render(<ConversationMessageHeader message={baseMessage} />);
    });

    const header = container.querySelector('[data-testid="conversation-message-header"]');
    expect(header).not.toBeNull();

    const modelName = container.querySelector('[data-testid="conversation-message-model-name"]');
    expect(modelName).toBeNull();

    const providerName = container.querySelector(
      '[data-testid="conversation-message-provider-name"]',
    );
    expect(providerName).toBeNull();

    const time = container.querySelector('[data-testid="conversation-message-time"]');
    expect(time).not.toBeNull();
  });

  it('renders usage chip when provided', () => {
    act(() => {
      root.render(
        <ConversationMessageHeader
          message={baseMessage}
          model={model}
          shortModelName="claude-sonnet-4"
          providerName="Anthropic"
          usageChip={{
            text: '1.2K → 486',
            isEstimated: false,
            tooltip: '1.2K prompt, 486 completion (450ms)',
          }}
        />,
      );
    });

    const chip = container.querySelector('[data-testid="conversation-message-usage-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('1.2K → 486');
    expect(chip?.classList.contains('is-estimated')).toBe(false);
  });

  it('renders estimated usage chip with is-estimated class', () => {
    act(() => {
      root.render(
        <ConversationMessageHeader
          message={baseMessage}
          model={model}
          shortModelName="claude-sonnet-4"
          providerName="Anthropic"
          usageChip={{
            text: '~1.2K → 486',
            isEstimated: true,
            tooltip: '估算 Token 消耗',
          }}
        />,
      );
    });

    const chip = container.querySelector('[data-testid="conversation-message-usage-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('~1.2K → 486');
    expect(chip?.classList.contains('is-estimated')).toBe(true);
  });
});

describe('buildConversationTurnUsageChip', () => {
  it('formats prompt and completion tokens for assistant-usage', () => {
    const usage: ContextUsageSnapshot = {
      sessionId: 's-1',
      updatedAt: '2026-08-18T14:15:00.000Z',
      source: 'assistant-usage',
      promptTokens: 1200,
      completionTokens: 486,
      totalTokens: 1686,
      durationMs: 450,
    };

    const chip = buildConversationTurnUsageChip(usage, 'zh-CN');
    expect(chip).not.toBeNull();
    expect(chip?.text).toBe('1.2K → 486');
    expect(chip?.isEstimated).toBe(false);
    expect(chip?.tooltip).toContain('450ms');
  });

  it('adds estimate prefix for host-estimate', () => {
    const usage: ContextUsageSnapshot = {
      sessionId: 's-1',
      updatedAt: '2026-08-18T14:15:00.000Z',
      source: 'host-estimate',
      promptTokens: 1500,
      completionTokens: 300,
      totalTokens: 1800,
    };

    const chip = buildConversationTurnUsageChip(usage, 'zh-CN');
    expect(chip).not.toBeNull();
    expect(chip?.text).toBe('~1.5K → 300');
    expect(chip?.isEstimated).toBe(true);
    expect(chip?.tooltip).toContain('估算');
  });

  it('returns null for pi-contextUsage or null/undefined', () => {
    const windowUsage: ContextUsageSnapshot = {
      sessionId: 's-1',
      updatedAt: '2026-08-18T14:15:00.000Z',
      source: 'pi-contextUsage',
      promptTokens: 50000,
    };

    expect(buildConversationTurnUsageChip(windowUsage)).toBeNull();
    expect(buildConversationTurnUsageChip(null)).toBeNull();
    expect(buildConversationTurnUsageChip(undefined)).toBeNull();
  });
});
