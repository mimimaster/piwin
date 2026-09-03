import { describe, expect, it } from 'vitest';
import {
  PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION,
  PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION,
  PIWIN_LIVE_INSTRUCTIONS,
  PIWIN_LIVE_SPOKEN_CONTRACT,
  PIWIN_LIVE_STOP_INSTRUCTION,
  PIWIN_LIVE_WORK_PREAMBLE,
  composeLiveSpokenInstructions,
  isLiveStopInstruction,
  piwinLiveRetargetContext,
  sanitizeLiveDelegationInstruction,
  wrapLiveDelegationForAgent,
} from './live-delegation-instruction.js';

describe('sanitizeLiveDelegationInstruction', () => {
  it('preserves bracketed task data and negative constraints', () => {
    expect(sanitizeLiveDelegationInstruction('不要[删除文件]，只分析 src/[id].ts')).toBe('不要[删除文件]，只分析 src/[id].ts');
  });
  it('drops throat-clear ASR tags and leftover filler', () => {
    expect(sanitizeLiveDelegationInstruction('[clear throat] 噢。')).toBeNull();
    expect(sanitizeLiveDelegationInstruction('[laughter]')).toBeNull();
    expect(sanitizeLiveDelegationInstruction('  um  ')).toBeNull();
    expect(sanitizeLiveDelegationInstruction('嗯')).toBeNull();
  });

  it('keeps a real task after stripping non-speech tags', () => {
    expect(sanitizeLiveDelegationInstruction('[clear throat] 帮我排查语音问题')).toBe(
      '帮我排查语音问题',
    );
    expect(sanitizeLiveDelegationInstruction('fix the failing tests')).toBe('fix the failing tests');
  });

  it('does not treat a real sentence as filler because it contains 好', () => {
    expect(sanitizeLiveDelegationInstruction('好的帮我看看刚才的报错')).toBe(
      '好的帮我看看刚才的报错',
    );
  });
});

describe('spoken contracts', () => {
  it('keeps the spoken surface free of tool names', () => {
    expect(PIWIN_LIVE_SPOKEN_CONTRACT).toContain('speaking face of this work session');
    expect(PIWIN_LIVE_SPOKEN_CONTRACT).not.toContain('<');
    expect(PIWIN_LIVE_SPOKEN_CONTRACT).not.toContain('delegate_to_work_session');
    expect(PIWIN_LIVE_INSTRUCTIONS).toContain('live delegation channel');
    expect(PIWIN_LIVE_INSTRUCTIONS).not.toContain('<');
    expect(composeLiveSpokenInstructions('tool-handover')).toContain('delegate_to_work_session');
    expect(PIWIN_LIVE_DELEGATE_TOOL_DESCRIPTION).toContain('not permission to execute');
    expect(PIWIN_LIVE_DELEGATE_INSTRUCTION_DESCRIPTION).toContain('preserving negations and uncertainty');
  });

  it('names the retargeted session without XML or tool names', () => {
    const text = piwinLiveRetargetContext('Other');
    expect(text).toContain('session titled "Other"');
    expect(text).not.toContain('<');
    expect(text).not.toContain('delegate_to_work_session');
  });
});

describe('wrapLiveDelegationForAgent', () => {
  it('wraps a brief and adds the work preamble only on the first call handover', () => {
    expect(wrapLiveDelegationForAgent('搜索近期资料')).toBe(
      '<voice_brief>\n搜索近期资料\n</voice_brief>',
    );
    const first = wrapLiveDelegationForAgent('搜索近期资料', { firstForCall: true });
    expect(first).toContain(PIWIN_LIVE_WORK_PREAMBLE);
    expect(first).toContain('<voice_brief>\n搜索近期资料\n</voice_brief>');
    expect(wrapLiveDelegationForAgent(PIWIN_LIVE_STOP_INSTRUCTION)).toBe(
      PIWIN_LIVE_STOP_INSTRUCTION,
    );
  });
});

describe('isLiveStopInstruction', () => {
  it('accepts the protocol token only', () => {
    expect(isLiveStopInstruction(PIWIN_LIVE_STOP_INSTRUCTION)).toBe(true);
    expect(isLiveStopInstruction('STOP_CURRENT_RUN。')).toBe(true);
    expect(isLiveStopInstruction('停一下')).toBe(false);
    expect(isLiveStopInstruction('stop')).toBe(false);
  });
});
