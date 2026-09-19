import { describe, expect, it } from 'vitest';
import { parseRestrictedExecArguments, formatCommandSlotErrors } from './command-parse.js';

describe('parseRestrictedExecArguments', () => {
  it('parses all five command types from their slots', () => {
    const result = parseRestrictedExecArguments(
      {
        command1: { type: 'rg', pattern: 'handler', path: '/codebase/src', include: ['**/*.ts'] },
        command2: { type: 'readfile', file: '/codebase/a.ts', start_line: 1, end_line: 20 },
        command3: { type: 'tree', path: '/codebase', levels: 2 },
        command4: { type: 'ls', path: '/codebase/src', long_format: true, all: true },
        command5: { type: 'glob', pattern: '**/*.ts', path: '/codebase', type_filter: 'all' },
      },
      8,
    );
    expect(result.errors).toEqual([]);
    expect(result.commands).toEqual([
      { type: 'rg', pattern: 'handler', path: '/codebase/src', include: ['**/*.ts'] },
      { type: 'readfile', file: '/codebase/a.ts', start_line: 1, end_line: 20 },
      { type: 'tree', path: '/codebase', levels: 2 },
      { type: 'ls', path: '/codebase/src', long_format: true, all: true },
      { type: 'glob', pattern: '**/*.ts', path: '/codebase', type_filter: 'all' },
    ]);
  });

  it('runs slots in numeric order regardless of key order', () => {
    const result = parseRestrictedExecArguments(
      {
        command3: { type: 'tree', path: '/codebase' },
        command1: { type: 'readfile', file: '/codebase/a.ts' },
        command2: { type: 'ls', path: '/codebase' },
      },
      8,
    );
    expect(result.commands.map((command) => command.type)).toEqual(['readfile', 'ls', 'tree']);
  });

  it('caps the batch at maxCommands', () => {
    const args: Record<string, unknown> = {};
    for (let index = 1; index <= 6; index += 1) {
      args[`command${index}`] = { type: 'ls', path: `/codebase/d${index}` };
    }
    const result = parseRestrictedExecArguments(args, 2);
    expect(result.commands).toHaveLength(2);
    expect(result.commands.map((command) => (command.type === 'ls' ? command.path : ''))).toEqual([
      '/codebase/d1',
      '/codebase/d2',
    ]);
  });

  it('reports a bad slot without discarding the good ones', () => {
    const result = parseRestrictedExecArguments(
      {
        command1: { type: 'rg', path: '/codebase/src' },
        command2: { type: 'rg', pattern: 'ok', path: '/codebase/src' },
        command3: { type: 'sed', pattern: 'x', path: '/codebase' },
        command4: 'not-an-object',
      },
      8,
    );
    expect(result.commands).toHaveLength(1);
    expect(result.errors).toEqual([
      { slot: 'command1', message: 'rg requires a non-empty pattern' },
      { slot: 'command3', message: 'unknown command type "sed"' },
      { slot: 'command4', message: 'command must be an object' },
    ]);
  });

  it('ignores keys that are not command slots', () => {
    const result = parseRestrictedExecArguments(
      { command1: { type: 'ls', path: '/codebase' }, thinking: 'hmm', commandX: {} },
      8,
    );
    expect(result.commands).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('coerces numeric and string line numbers and drops junk options', () => {
    const result = parseRestrictedExecArguments(
      {
        command1: {
          type: 'readfile',
          file: '/codebase/a.ts',
          start_line: '3',
          end_line: 4.9,
        },
        command2: { type: 'tree', path: '/codebase', levels: 'nope' },
        command3: { type: 'rg', pattern: 'x', path: '/codebase', include: [], exclude: ['', '  '] },
      },
      8,
    );
    expect(result.commands).toEqual([
      { type: 'readfile', file: '/codebase/a.ts', start_line: 3, end_line: 4 },
      { type: 'tree', path: '/codebase' },
      { type: 'rg', pattern: 'x', path: '/codebase' },
    ]);
  });

  it('rejects an unknown glob type_filter instead of guessing', () => {
    const result = parseRestrictedExecArguments(
      { command1: { type: 'glob', pattern: '*.ts', path: '/codebase', type_filter: 'symlink' } },
      8,
    );
    expect(result.commands).toEqual([{ type: 'glob', pattern: '*.ts', path: '/codebase' }]);
  });

  it('returns an empty batch for empty arguments', () => {
    const result = parseRestrictedExecArguments({}, 8);
    expect(result).toEqual({ commands: [], errors: [] });
  });
});

describe('formatCommandSlotErrors', () => {
  it('renders one error line per slot', () => {
    expect(
      formatCommandSlotErrors([
        { slot: 'command1', message: 'rg requires a non-empty path' },
        { slot: 'command2', message: 'command must be an object' },
      ]),
    ).toBe(
      'Error: command1: rg requires a non-empty path\nError: command2: command must be an object',
    );
  });
});
