/**
 * Post-turn reply rewrite (spec: reply-writer).
 * Pure types and helpers — no runtime deps on other `@piwin/*` packages.
 */

import type { ModelRef } from './host.js';

export type ReplyWriterLanguage = 'zh-CN' | 'en' | 'follow-user';

export const REPLY_WRITER_LANGUAGES = ['zh-CN', 'en', 'follow-user'] as const;

export const DEFAULT_REPLY_WRITER_TIMEOUT_MS = 60_000;

export type ReplyWriterConfig = {
  /** Default false. Missing config is treated as disabled. */
  enabled: boolean;
  /** Writer model. Invalid or missing refs skip the rewrite. */
  model?: ModelRef;
  /** Default `zh-CN`. */
  language?: ReplyWriterLanguage;
  /** Override system prompt for the rewrite call. */
  systemPrompt?: string;
  /** Default 60_000. */
  timeoutMs?: number;
};

/** Attribution stored on the rewritten assistant transcript row. */
export type ReplyWriterAttribution = {
  model: ModelRef;
  language: ReplyWriterLanguage;
  /** Worker draft kept so the rewrite is auditable. */
  sourceText: string;
};

export function createDefaultReplyWriterConfig(): ReplyWriterConfig {
  return { enabled: false, language: 'zh-CN' };
}

export function isReplyWriterLanguage(value: unknown): value is ReplyWriterLanguage {
  return value === 'zh-CN' || value === 'en' || value === 'follow-user';
}

export function replyWriterModelsEqual(left?: ModelRef, right?: ModelRef): boolean {
  if (!left || !right) return false;
  return left.providerId === right.providerId && left.modelId === right.modelId;
}

export function shouldRewriteReply(params: {
  config: ReplyWriterConfig | undefined;
  assistantText: string;
  workerModel?: ModelRef;
  sessionKind?: 'main' | 'subagent' | 'side-chat';
}): boolean {
  const config = params.config;
  if (!config?.enabled || !config.model) return false;
  if (params.sessionKind === 'subagent' || params.sessionKind === 'side-chat') return false;
  if (params.assistantText.trim().length === 0) return false;
  if (replyWriterModelsEqual(config.model, params.workerModel)) return false;
  return true;
}
