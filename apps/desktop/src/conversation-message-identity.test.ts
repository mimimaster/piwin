import { describe, expect, it } from 'vitest';
import type { ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';
import {
  formatMessageTime,
  resolveConversationMessageModel,
  resolveModelDisplayName,
  resolveShortModelName,
} from './conversation-message-identity';

describe('conversation-message-identity', () => {
  describe('formatMessageTime', () => {
    it('formats ISO time to HH:MM', () => {
      const formatted = formatMessageTime('2026-08-18T14:15:00.000Z');
      expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    });

    it('returns empty string for missing or invalid dates', () => {
      expect(formatMessageTime(undefined)).toBe('');
      expect(formatMessageTime('')).toBe('');
      expect(formatMessageTime('invalid-date')).toBe('');
    });
  });

  describe('resolveShortModelName', () => {
    it('extracts segment after slash or colon', () => {
      expect(resolveShortModelName('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
      expect(resolveShortModelName('openai/gpt-4o-mini')).toBe('gpt-4o-mini');
      expect(resolveShortModelName('claude-3-7-sonnet')).toBe('claude-3-7-sonnet');
    });

    it('truncates excessively long model names with middle ellipsis', () => {
      const longName = 'anthropic/claude-3-5-sonnet-20241022-v1-custom';
      const shortName = resolveShortModelName(longName);
      expect(shortName.length).toBeLessThanOrEqual(28);
      expect(shortName).toContain('…');
    });

    it('handles empty input gracefully', () => {
      expect(resolveShortModelName('')).toBe('');
      expect(resolveShortModelName('   ')).toBe('');
    });
  });

  describe('resolveModelDisplayName', () => {
    const claudeRef: ModelRef = {
      protocol: 'anthropic-compatible',
      providerId: 'anthropic-main',
      modelId: 'claude-sonnet-4',
    };

    it('resolves label from modelOptions if matched', () => {
      const display = resolveModelDisplayName({
        model: claudeRef,
        modelOptions: [
          {
            providerId: 'anthropic-main',
            protocol: 'anthropic-compatible',
            modelId: 'claude-sonnet-4',
            label: 'Claude 3.7 Sonnet',
          },
        ],
      });
      expect(display.modelLabel).toBe('Claude 3.7 Sonnet');
      expect(display.shortModelName).toBe('Claude 3.7 Sonnet');
      expect(display.providerName).toBe('anthropic-main');
    });

    it('resolves label and provider name from configProviders', () => {
      const display = resolveModelDisplayName({
        model: claudeRef,
        configProviders: [
          {
            id: 'anthropic-main',
            protocol: 'anthropic-compatible',
            baseUrl: 'https://api.anthropic.com',
            name: 'Anthropic Direct',
            models: [
              {
                id: 'claude-sonnet-4',
                label: 'Claude Sonnet 4 (Fast)',
              },
            ],
          },
        ],
      });
      expect(display.providerName).toBe('Anthropic Direct');
      expect(display.modelLabel).toBe('Claude Sonnet 4 (Fast)');
    });

    it('falls back to raw IDs when config is deleted or unmapped', () => {
      const display = resolveModelDisplayName({
        model: {
          protocol: 'openai-compatible',
          providerId: 'custom-openai',
          modelId: 'meta-llama/Llama-3-70b-instruct',
        },
      });
      expect(display.providerName).toBe('custom-openai');
      expect(display.modelLabel).toBe('meta-llama/Llama-3-70b-instruct');
      expect(display.shortModelName).toBe('Llama-3-70b-instruct');
    });
  });

  describe('resolveConversationMessageModel', () => {
    const snapshotModel: ModelRef = {
      protocol: 'anthropic-compatible',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
    };
    const liveModel: ModelRef = {
      protocol: 'openai-compatible',
      providerId: 'openai',
      modelId: 'gpt-4o',
    };

    const baseMessage: ChatMessageUi = {
      id: 'msg-1',
      role: 'assistant',
      text: 'reply',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };

    it('prefers snapshot model over live model', () => {
      const resolved = resolveConversationMessageModel({
        message: { ...baseMessage, model: snapshotModel },
        livePromptModel: liveModel,
        isStreaming: true,
      });
      expect(resolved).toEqual(snapshotModel);
    });

    it('uses livePromptModel during active streaming when snapshot is not yet hydrated', () => {
      const resolved = resolveConversationMessageModel({
        message: { ...baseMessage, status: 'streaming' },
        livePromptModel: liveModel,
        isStreaming: true,
      });
      expect(resolved).toEqual(liveModel);
    });

    it('uses livePromptModel when snapshot is not yet hydrated even after streaming finishes', () => {
      const resolved = resolveConversationMessageModel({
        message: { ...baseMessage, status: 'done' },
        livePromptModel: liveModel,
        isStreaming: false,
      });
      expect(resolved).toEqual(liveModel);
    });

    it('returns undefined when neither snapshot nor live model is available', () => {
      const resolved = resolveConversationMessageModel({
        message: { ...baseMessage, status: 'done' },
        livePromptModel: null,
        isStreaming: false,
      });
      expect(resolved).toBeUndefined();
    });
  });
});
