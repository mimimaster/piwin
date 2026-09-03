import { describe, expect, it, vi } from 'vitest';
import {
  applySkillToPrompt,
  detectActiveSlashToken,
  isReservedComposerSlashCommand,
  isReservedSlashExecuteName,
  normalizeCompactCustomInstructions,
  parseComposerSlashSubmit,
  replaceActiveSlashToken,
  runReservedComposerSlashCommand,
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

  it('recognizes reserved compact submits', () => {
    expect(isReservedSlashExecuteName('compact')).toBe(true);
    expect(isReservedSlashExecuteName('summarize')).toBe(true);
    expect(isReservedSlashExecuteName('ultra-code')).toBe(true);
    expect(isReservedSlashExecuteName('agent')).toBe(false);
    expect(isReservedComposerSlashCommand('/compact')).toBe(true);
    expect(isReservedComposerSlashCommand('/compact keep tools')).toBe(true);
    expect(isReservedComposerSlashCommand('/agent')).toBe(false);
    expect(isReservedComposerSlashCommand('hello')).toBe(false);
  });

  it('runs reserved compact handler for whole-message submits', async () => {
    const compact = vi.fn(async () => true);
    expect(await runReservedComposerSlashCommand('/compact keep tools', { compact })).toBe(true);
    expect(compact).toHaveBeenCalledWith('keep tools');
    expect(await runReservedComposerSlashCommand('hello', { compact })).toBe(false);
  });

  it('treats /stop as unknown (removed command, not a reserved submit)', () => {
    expect(parseComposerSlashSubmit('/stop', skills)).toMatchObject({
      kind: 'unknown',
      name: 'stop',
    });
    expect(parseComposerSlashSubmit('/abort', skills)).toMatchObject({
      kind: 'unknown',
      name: 'abort',
    });
  });

  it('parses composer modes (Agent / Goal only)', () => {
    expect(parseComposerSlashSubmit('/agent', skills)).toEqual({
      kind: 'mode',
      modeId: 'agent',
      name: 'agent',
      args: '',
    });
    expect(parseComposerSlashSubmit('/goal finish feature', skills)).toMatchObject({
      kind: 'mode',
      modeId: 'goal',
      args: 'finish feature',
    });
  });

  it('does not treat retired /plan or /ask as modes', () => {
    expect(parseComposerSlashSubmit('/plan', skills)).toEqual({
      kind: 'unknown',
      name: 'plan',
      args: '',
    });
    expect(parseComposerSlashSubmit('/ask about auth', skills)).toEqual({
      kind: 'unknown',
      name: 'ask',
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

  it('resolves /write-plan alias to writing-plans skill', () => {
    expect(parseComposerSlashSubmit('/write-plan add auth', skills)).toEqual({
      kind: 'skill',
      skillId: 'writing-plans',
      skillName: 'writing-plans',
      args: 'add auth',
    });
  });

  it('still resolves canonical /writing-plans', () => {
    expect(parseComposerSlashSubmit('/writing-plans add auth', skills)).toEqual({
      kind: 'skill',
      skillId: 'writing-plans',
      skillName: 'writing-plans',
      args: 'add auth',
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

it('parses /scheme and /ultra-code as scheme selection', () => {
  expect(parseComposerSlashSubmit('/scheme', skills)).toEqual({
    kind: 'scheme',
    schemeId: 'off',
    name: 'scheme',
    args: '',
  });
  expect(parseComposerSlashSubmit('/scheme ultra-code', skills)).toMatchObject({
    kind: 'scheme',
    schemeId: 'ultra-code',
  });
  expect(parseComposerSlashSubmit('/ultra-code', skills)).toMatchObject({
    kind: 'scheme',
    schemeId: 'ultra-code',
  });
});

it('parses /knowledge, /flashcards, and /notes as knowledge submits', () => {
  expect(parseComposerSlashSubmit('/knowledge', skills)).toEqual({
    kind: 'knowledge',
    subTab: 'doccards',
    name: 'knowledge',
    args: '',
  });
  expect(parseComposerSlashSubmit('/doccards', skills)).toEqual({
    kind: 'knowledge',
    subTab: 'doccards',
    name: 'doccards',
    args: '',
  });
  expect(parseComposerSlashSubmit('/flashcards', skills)).toEqual({
    kind: 'cards-panel',
    name: 'flashcards',
    args: '',
  });
  expect(parseComposerSlashSubmit('/cards', skills)).toEqual({
    kind: 'cards-panel',
    name: 'cards',
    args: '',
  });
  expect(parseComposerSlashSubmit('/notes', skills)).toEqual({
    kind: 'knowledge',
    subTab: 'wiki',
    name: 'notes',
    args: '',
  });
  expect(parseComposerSlashSubmit('/wiki', skills)).toEqual({
    kind: 'knowledge',
    subTab: 'wiki',
    name: 'wiki',
    args: '',
  });
});
