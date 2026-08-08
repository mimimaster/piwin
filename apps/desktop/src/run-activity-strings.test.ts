import { describe, expect, it } from 'vitest';
import {
  buildBasePhrases,
  buildTakingTooLongPhrases,
  buildActivityPhrases,
  RUNTIME_STATUS_COPY,
  runtimeStatusText,
} from './run-activity-strings.js';
import type { RunActivityInput } from './run-activity-types.js';

const en = (overrides: Partial<RunActivityInput> = {}): RunActivityInput => ({
  kind: 'waiting-first-token',
  locale: 'en',
  ...overrides,
});

describe('buildBasePhrases', () => {
  it('uses the reference copy for waiting-first-token en', () => {
    const phrases = buildBasePhrases(en());
    expect(phrases).toEqual(['Thinking…']);
  });

  it('keeps the runtime working status stable when a tool is active', () => {
    const phrases = buildBasePhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases).toEqual(['Working…']);
  });

  it('keeps runtime status separate from the detailed tool timeline', () => {
    const phrases = buildBasePhrases(
      en({
        kind: 'working',
        activeToolName: 'read',
        actionVerb: 'Read',
        detail: 'apps/desktop/src/App.tsx',
      }),
    );
    expect(phrases).toEqual(['Working…']);
  });

  it('localizes actionVerb for zh-CN work lines', () => {
    const phrases = buildBasePhrases({
      kind: 'working',
      locale: 'zh-CN',
      activeToolName: 'read',
      actionVerb: 'Read',
      detail: 'packages/pet/src/index.ts',
    });
    expect(phrases[0]).toBe('正在处理…');
  });

  it('uses the reference planning status instead of the internal plan step', () => {
    const phrases = buildBasePhrases(en({ kind: 'planning', planStep: 'Add auth' }));
    expect(phrases).toEqual(['Planning']);
  });

  it('localizes to zh-CN', () => {
    const phrases = buildBasePhrases({ kind: 'waiting-first-token', locale: 'zh-CN' });
    expect(phrases[0]).toBe('正在思考…');
  });

  it('keeps every txt status key available as an exact bilingual pair', () => {
    expect(RUNTIME_STATUS_COPY).toEqual({
      preparing: { zh: '准备上下文…', en: 'Preparing context…' },
      'connecting-model': { zh: '连接模型…', en: 'Connecting to model…' },
      'waiting-first-token': { zh: '正在思考…', en: 'Thinking…' },
      working: { zh: '正在处理…', en: 'Working…' },
      stopping: { zh: '正在停止…', en: 'Stopping…' },
      thinking: { zh: '思考中', en: 'Thinking' },
      planning: { zh: '制定计划中', en: 'Planning' },
      asking: { zh: '等待你的回答', en: 'Waiting for your answer' },
    });
    expect(runtimeStatusText('asking', 'zh-CN')).toBe('等待你的回答');
    expect(runtimeStatusText('asking', 'en')).toBe('Waiting for your answer');
  });
});

describe('buildTakingTooLongPhrases', () => {
  it('keeps the exact runtime status when a run takes longer', () => {
    const phrases = buildTakingTooLongPhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases).toEqual(['Working…']);
  });

  it('keeps the reference thinking copy for waiting-first-token', () => {
    const phrases = buildTakingTooLongPhrases(en());
    expect(phrases).toEqual(['Thinking…']);
  });
});

describe('buildActivityPhrases', () => {
  it('does not replace the reference status after the timeout threshold', () => {
    const phrases = buildActivityPhrases(en({ elapsedMs: 20_000 }));
    expect(phrases).toEqual(['Thinking…']);
  });
});
