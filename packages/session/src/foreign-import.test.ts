import { describe, expect, it } from 'vitest';
import {
  foreignSessionTitle,
  limitForeignTurns,
  matchForeignImportPrompt,
  parseForeignTranscript,
} from './foreign-import.js';

describe('matchForeignImportPrompt', () => {
  it('rejects ordinary prompts and the built-in import command', () => {
    expect(matchForeignImportPrompt('hello')).toBeNull();
    expect(matchForeignImportPrompt('/import ./session.jsonl')).toBeNull();
    expect(matchForeignImportPrompt('please /resume-claude latest')).toBeNull();
  });

  it('parses harness, mode, turns, and target', () => {
    expect(matchForeignImportPrompt('/resume-claude 46b90abf --mode strict --turns 12')).toEqual({
      harness: 'claude',
      mode: 'strict',
      turns: 12,
      target: '46b90abf',
    });
    expect(matchForeignImportPrompt('/resume-opencode')).toMatchObject({
      harness: 'opencode',
      target: '',
      turns: 60,
    });
  });
});

describe('parseForeignTranscript', () => {
  it('keeps Claude text and drops tool calls unless strict', () => {
    const raw = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: '<system-reminder>secret</system-reminder>\nfix the login' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Looking.' },
            { type: 'tool_use', name: 'bash', input: { command: 'ls' } },
          ],
        },
      }),
    ].join('\n');
    expect(parseForeignTranscript('claude', raw, 'compact')).toEqual([
      { role: 'user', text: 'fix the login' },
      { role: 'assistant', text: 'Looking.' },
    ]);
    expect(parseForeignTranscript('claude', raw, 'strict')[1]?.text).toContain('[tool bash]');
  });

  it('redacts secrets and caps retained turns', () => {
    const raw = JSON.stringify({
      role: 'user',
      content: 'token Bearer abcdefghijklmnop',
    });
    const parsed = parseForeignTranscript('cursor', raw, 'compact');
    expect(parsed[0]?.text).toBe('token [redacted]');
    const limited = limitForeignTurns(
      [
        { role: 'user', text: 'one' },
        { role: 'assistant', text: 'two' },
        { role: 'user', text: 'three' },
      ],
      2,
    );
    expect(limited.omitted).toBe(1);
    expect(limited.turns.map((turn) => turn.text)).toEqual(['two', 'three']);
    expect(foreignSessionTitle(parsed, 'fallback')).toBe('token [redacted]');
  });

  it('reads Codex user_message payloads', () => {
    const raw = JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'ship the importer' },
    });
    expect(parseForeignTranscript('codex', raw, 'compact')).toEqual([
      { role: 'user', text: 'ship the importer' },
    ]);
  });
});
