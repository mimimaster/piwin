import { describe, expect, it } from 'vitest';
import {
  createDefaultReplyWriterConfig,
  isReplyWriterLanguage,
  replyWriterModelsEqual,
  shouldRewriteReply,
} from './reply-writer.js';

const writer = {
  protocol: 'openai-compatible' as const,
  providerId: 'openai',
  modelId: 'gpt-4.1',
};

const worker = {
  protocol: 'openai-compatible' as const,
  providerId: 'cheap',
  modelId: 'coder-flash',
};

describe('reply writer policy', () => {
  it('defaults to disabled Chinese rewrite', () => {
    expect(createDefaultReplyWriterConfig()).toEqual({ enabled: false, language: 'zh-CN' });
    expect(isReplyWriterLanguage('zh-CN')).toBe(true);
    expect(isReplyWriterLanguage('ja')).toBe(false);
  });

  it('requires enabled config, a writer model, and non-empty assistant text', () => {
    expect(
      shouldRewriteReply({
        config: { enabled: true, model: writer },
        assistantText: 'done',
        workerModel: worker,
      }),
    ).toBe(true);
    expect(
      shouldRewriteReply({
        config: { enabled: false, model: writer },
        assistantText: 'done',
        workerModel: worker,
      }),
    ).toBe(false);
    expect(
      shouldRewriteReply({
        config: { enabled: true },
        assistantText: 'done',
        workerModel: worker,
      }),
    ).toBe(false);
    expect(
      shouldRewriteReply({
        config: { enabled: true, model: writer },
        assistantText: '   ',
        workerModel: worker,
      }),
    ).toBe(false);
  });

  it('skips the same model and non-foreground sessions', () => {
    expect(replyWriterModelsEqual(writer, { ...writer, protocol: 'anthropic-compatible' })).toBe(
      true,
    );
    expect(
      shouldRewriteReply({
        config: { enabled: true, model: writer },
        assistantText: 'done',
        workerModel: writer,
      }),
    ).toBe(false);
    expect(
      shouldRewriteReply({
        config: { enabled: true, model: writer },
        assistantText: 'done',
        workerModel: worker,
        sessionKind: 'subagent',
      }),
    ).toBe(false);
  });
});
