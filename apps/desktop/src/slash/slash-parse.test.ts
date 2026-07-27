import { describe, expect, it } from 'vitest';
import {
  applySkillToPrompt,
  detectActiveSlashToken,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
  replaceActiveSlashToken,
} from './slash-parse';

const skills = [
  { id: 'create-skill', name: 'create-skill', enabled: true },
  { id: 'writing-plans', name: 'writing-plans', enabled: true },
];

describe('detectActiveSlashToken', () => {
  it('detects leading slash token', () => {
    const token = detectActiveSlashToken('/comp', 5);
    expect(token).toEqual({
      raw: '/comp',
      query: 'comp',
      startIndex: 0,
      endIndex: 5,
    });
  });

  it('detects mid-line slash token', () => {
    const text = 'please /compact now';
    const slashAt = text.indexOf('/');
    const token = detectActiveSlashToken(text, slashAt + 3);
    expect(token?.raw).toBe('/compact');
    expect(token?.startIndex).toBe(slashAt);
  });

  it('returns null when not in slash token', () => {
    expect(detectActiveSlashToken('hello world', 5)).toBeNull();
    expect(detectActiveSlashToken('a/b', 2)).toBeNull();
  });
});

describe('parseComposerSlashSubmit', () => {
  it('parses compact and aliases', () => {
    expect(parseComposerSlashSubmit('/compact', skills)).toEqual({
      kind: 'command',
      commandId: 'compact',
      name: 'compact',
      args: '',
    });
    expect(parseComposerSlashSubmit('/summarize keep tools', skills)).toMatchObject({
      kind: 'command',
      commandId: 'compact',
      name: 'summarize',
      args: 'keep tools',
    });
    expect(parseComposerSlashSubmit('/compress', skills)).toMatchObject({
      commandId: 'compact',
    });
  });

  it('parses stop and abort', () => {
    expect(parseComposerSlashSubmit('/stop', skills)).toMatchObject({
      kind: 'command',
      commandId: 'stop',
    });
    expect(parseComposerSlashSubmit('/abort', skills)).toMatchObject({
      commandId: 'stop',
    });
  });

  it('parses modes', () => {
    expect(parseComposerSlashSubmit('/plan', skills)).toEqual({
      kind: 'mode',
      modeId: 'plan',
      name: 'plan',
      args: '',
    });
    expect(parseComposerSlashSubmit('/ask about auth', skills)).toMatchObject({
      kind: 'mode',
      modeId: 'ask',
      args: 'about auth',
    });
  });

  it('parses known skills', () => {
    expect(parseComposerSlashSubmit('/create-skill make foo', skills)).toEqual({
      kind: 'skill',
      skillId: 'create-skill',
      skillName: 'create-skill',
      args: 'make foo',
    });
  });

  it('unknown slash stays unknown (send as text)', () => {
    expect(parseComposerSlashSubmit('/canvas', skills)).toEqual({
      kind: 'unknown',
      name: 'canvas',
      args: '',
    });
  });

  it('plain text is none', () => {
    expect(parseComposerSlashSubmit('hello', skills)).toEqual({ kind: 'none' });
  });
});

describe('replaceActiveSlashToken', () => {
  it('replaces token with command insert', () => {
    const text = '/comp';
    const token = detectActiveSlashToken(text, text.length);
    expect(token).not.toBeNull();
    expect(replaceActiveSlashToken(text, token!, '/compact ')).toBe('/compact ');
  });
});

describe('normalizeCompactCustomInstructions', () => {
  it('returns undefined for empty', () => {
    expect(normalizeCompactCustomInstructions('  ')).toBeUndefined();
  });

  it('caps long args', () => {
    const long = 'x'.repeat(3000);
    const result = normalizeCompactCustomInstructions(long);
    expect(result?.length).toBe(2048);
  });
});

describe('applySkillToPrompt', () => {
  it('includes skill markers', () => {
    const out = applySkillToPrompt('create-skill', 'create-skill', 'add deploy skill');
    expect(out).toContain('[piwin-skill:create-skill]');
    expect(out).toContain('add deploy skill');
  });
});
