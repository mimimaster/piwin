import type {
  ImageGenerationConfig,
  ReplyWriterConfig,
  SpeechConfig,
  ThinkingConfig,
  VideoGenerationConfig,
  VisionDelegationConfig,
} from '@piwin/contracts';
import {
  asPositiveNumber,
  asRecord,
  isThinkingLevel,
  normalizeModelRef,
} from './config-store-primitives.js';

/**
 * Normalize per-capability model config: image/video generation, live voice, speech, reply writer, vision delegation, thinking.
 */

export function normalizeImageGenerationConfig(value: unknown): ImageGenerationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const defaultModel = normalizeModelRef(record.defaultModel);
  if (!defaultModel) {
    return undefined;
  }
  return { defaultModel };
}

export function normalizeVideoGenerationConfig(value: unknown): VideoGenerationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const defaultModel = normalizeModelRef(record.defaultModel);
  if (!defaultModel) {
    return undefined;
  }
  return { defaultModel };
}

export function normalizeLiveByProvider(
  value: unknown,
): Record<string, Record<string, string>> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const byProvider: Record<string, Record<string, string>> = {};
  for (const [providerId, raw] of Object.entries(record)) {
    const fields = asRecord(raw);
    if (!fields) continue;
    const normalized: Record<string, string> = {};
    for (const [key, fieldValue] of Object.entries(fields)) {
      if (typeof fieldValue === 'string' && fieldValue.trim()) {
        normalized[key] = fieldValue.trim();
      }
    }
    if (Object.keys(normalized).length > 0) byProvider[providerId] = normalized;
  }
  return Object.keys(byProvider).length > 0 ? byProvider : undefined;
}

export function normalizeSpeechConfig(value: unknown): SpeechConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: SpeechConfig = {};
  const asrRecord = asRecord(record.asr);
  if (asrRecord) {
    const asr: NonNullable<SpeechConfig['asr']> = {};
    const defaultModel = normalizeModelRef(asrRecord.defaultModel);
    if (defaultModel) {
      asr.defaultModel = defaultModel;
    }
    if (typeof asrRecord.language === 'string' && asrRecord.language.trim()) {
      asr.language = asrRecord.language.trim();
    }
    if (Object.keys(asr).length > 0) {
      normalized.asr = asr;
    }
  }
  const ttsRecord = asRecord(record.tts);
  if (ttsRecord) {
    const tts: NonNullable<SpeechConfig['tts']> = {};
    const defaultModel = normalizeModelRef(ttsRecord.defaultModel);
    if (defaultModel) {
      tts.defaultModel = defaultModel;
    }
    if (typeof ttsRecord.voice === 'string' && ttsRecord.voice.trim()) {
      tts.voice = ttsRecord.voice.trim();
    }
    if (Object.keys(tts).length > 0) {
      normalized.tts = tts;
    }
  }
  const liveRecord = asRecord(record.live);
  if (liveRecord) {
    const live: NonNullable<SpeechConfig['live']> = {
      enabled: liveRecord.enabled === true,
    };
    if (typeof liveRecord.voice === 'string' && liveRecord.voice.trim()) {
      live.voice = liveRecord.voice.trim();
    }
    if (typeof liveRecord.providerId === 'string' && liveRecord.providerId.trim()) {
      live.providerId = liveRecord.providerId.trim();
    }
    const byProvider = normalizeLiveByProvider(liveRecord.byProvider);
    if (byProvider) live.byProvider = byProvider;
    normalized.live = live;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeReplyWriterConfig(value: unknown): ReplyWriterConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: ReplyWriterConfig = {
    enabled: record.enabled === true,
  };
  const model = normalizeModelRef(record.model);
  if (model) {
    normalized.model = model;
  }
  if (
    record.language === 'zh-CN' ||
    record.language === 'en' ||
    record.language === 'follow-user'
  ) {
    normalized.language = record.language;
  }
  if (typeof record.systemPrompt === 'string' && record.systemPrompt.trim()) {
    normalized.systemPrompt = record.systemPrompt;
  }
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) {
    normalized.timeoutMs = timeoutMs;
  }
  return normalized;
}

export function normalizeVisionDelegationConfig(
  value: unknown,
): VisionDelegationConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: VisionDelegationConfig = {
    enabled: record.enabled === true,
  };
  const model = normalizeModelRef(record.model);
  if (model) {
    normalized.model = model;
  }
  if (typeof record.systemPrompt === 'string' && record.systemPrompt.trim()) {
    normalized.systemPrompt = record.systemPrompt;
  }
  const timeoutMs = asPositiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) {
    normalized.timeoutMs = timeoutMs;
  }
  if (typeof record.cacheEnabled === 'boolean') {
    normalized.cacheEnabled = record.cacheEnabled;
  }
  return normalized;
}

export function normalizeThinkingConfig(value: unknown): ThinkingConfig | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  const normalized: ThinkingConfig = {
    ultraEnabled: record.ultraEnabled === true,
  };
  if (isThinkingLevel(record.defaultLevel)) {
    normalized.defaultLevel = record.defaultLevel;
  }
  return normalized;
}
