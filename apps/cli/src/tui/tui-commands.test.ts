import { describe, expect, it } from 'vitest';
import { parseSlashCommand } from './tui-commands.js';

describe('parseSlashCommand', () => {
  it('parses a known command and its argument', () => {
    expect(parseSlashCommand('/rename  新名字 ')).toEqual({ name: 'rename', argument: '新名字' });
    expect(parseSlashCommand('/pin')).toEqual({ name: 'pin', argument: '' });
    expect(parseSlashCommand('/sessions')).toEqual({ name: 'sessions', argument: '' });
  });

  it('leaves unknown slash text as a prompt for the agent', () => {
    expect(parseSlashCommand('/etc/hosts 是什么')).toBeUndefined();
    expect(parseSlashCommand('/review this diff')).toBeUndefined();
    expect(parseSlashCommand('plain text')).toBeUndefined();
  });
});
