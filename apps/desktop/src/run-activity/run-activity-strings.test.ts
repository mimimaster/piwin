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
    expect(phrases[0]).toBe('Thinking…');
    expect(phrases).toEqual([
      'Thinking…',
      'Parsing context and instructions…',
      'Planning execution path…',
      'Formulating response…',
    ]);
  });

  it('rotates connecting-model phrases in both locales', () => {
    expect(buildBasePhrases({ kind: 'connecting-model', locale: 'zh-CN' })).toEqual([
      '连接模型…',
      '建立会话通道…',
      '校验运行上下文…',
      '等待模型响应…',
    ]);
    expect(buildBasePhrases({ kind: 'connecting-model', locale: 'en' })).toEqual([
      'Connecting to model…',
      'Opening session channel…',
      'Verifying runtime context…',
      'Waiting for model response…',
    ]);
  });

  it('falls back to the active tool name when structured detail is unavailable', () => {
    const phrases = buildBasePhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases).toEqual(['Running bash']);
  });

  it('shows structured live tool intent instead of a generic runtime label', () => {
    const phrases = buildBasePhrases(
      en({
        kind: 'working',
        activeToolName: 'read',
        actionVerb: 'Read',
        detail: 'apps/desktop/src/App.tsx',
      }),
    );
    expect(phrases).toEqual(['Read apps/desktop/src/App.tsx']);
  });

  it('localizes actionVerb for zh-CN work lines', () => {
    const phrases = buildBasePhrases({
      kind: 'working',
      locale: 'zh-CN',
      activeToolName: 'read',
      actionVerb: 'Read',
      detail: 'packages/pet/src/index.ts',
    });
    expect(phrases[0]).toBe('读取 packages/pet/src/index.ts');
  });

  it('uses the reference planning status with rotating phrases', () => {
    const phrases = buildBasePhrases(en({ kind: 'planning', planStep: 'Add auth' }));
    expect(phrases[0]).toBe('Planning');
    expect(phrases).toEqual([
      'Planning',
      'Breaking down task steps…',
      'Evaluating dependencies…',
    ]);
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

  it('rotates three preparing phrases in both locales', () => {
    expect(buildBasePhrases({ kind: 'preparing', locale: 'zh-CN' })).toEqual([
      '准备上下文…',
      '整理对话记忆…',
      '装载工作区…',
    ]);
    expect(buildBasePhrases({ kind: 'preparing', locale: 'en' })).toEqual([
      'Preparing context…',
      'Gathering conversation memory…',
      'Loading workspace…',
    ]);
  });
});

describe('buildTakingTooLongPhrases', () => {
  it('keeps concrete tool identity when a run takes longer', () => {
    const phrases = buildTakingTooLongPhrases(en({ kind: 'working', activeToolName: 'bash' }));
    expect(phrases).toEqual(['Running bash — taking longer…', 'Still working…']);
  });

  it('keeps the reference thinking copy for waiting-first-token', () => {
    const phrases = buildTakingTooLongPhrases(en());
    expect(phrases[0]).toBe('Thinking…');
    expect(phrases).toEqual([
      'Thinking…',
      'Parsing context and instructions…',
      'Planning execution path…',
      'Formulating response…',
    ]);
  });

  it('keeps preparing carousel when the wait exceeds the timeout threshold', () => {
    expect(buildTakingTooLongPhrases({ kind: 'preparing', locale: 'en' })).toEqual([
      'Preparing context…',
      'Gathering conversation memory…',
      'Loading workspace…',
    ]);
  });
});

describe('buildActivityPhrases', () => {
  it('does not replace the reference status after the timeout threshold', () => {
    const phrases = buildActivityPhrases(en({ elapsedMs: 20_000 }));
    expect(phrases[0]).toBe('Thinking…');
  });
});
