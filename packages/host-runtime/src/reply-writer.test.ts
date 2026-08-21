import { describe, expect, it } from 'vitest';
import {
  assembleReplyWriterSystemPrompt,
  assembleReplyWriterUserPrompt,
  boundReplyWriterSourceText,
  DEFAULT_REPLY_WRITER_SYSTEM_PROMPT,
} from './reply-writer.js';

describe('reply writer prompts', () => {
  it('uses the product system prompt unless overridden', () => {
    expect(assembleReplyWriterSystemPrompt(undefined)).toBe(DEFAULT_REPLY_WRITER_SYSTEM_PROMPT);
    expect(assembleReplyWriterSystemPrompt({ enabled: true, systemPrompt: '  Keep facts.  ' })).toBe(
      'Keep facts.',
    );
  });

  it('asks for fluent Chinese and bounds evidence', () => {
    const prompt = assembleReplyWriterUserPrompt({
      language: 'zh-CN',
      evidence: {
        userText: '修一下登录',
        draftText: '登录 路径 已改 看 文件',
        tools: [{ name: 'edit', output: 'ok\n'.repeat(2000) }],
      },
    });
    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('修一下登录');
    expect(prompt).toContain('登录 路径 已改 看 文件');
    expect(prompt).toContain('1. edit');
    expect(prompt).toContain('[truncated]');
  });

  it('bounds stored worker drafts', () => {
    const source = boundReplyWriterSourceText('x'.repeat(40_000));
    expect(source.endsWith('[truncated]')).toBe(true);
    expect(source.length).toBeLessThan(40_000);
  });
});
