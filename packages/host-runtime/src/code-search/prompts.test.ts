import { describe, expect, it } from 'vitest';
import {
  CODE_SEARCH_ANSWER_INSTRUCTION,
  CODE_SEARCH_FORCE_ANSWER,
  buildCodeSearchSystemPrompt,
  buildCodeSearchUserMessage,
} from './prompts.js';
import {
  CODE_SEARCH_ANSWER_TOOL,
  CODE_SEARCH_COMMAND_TYPES,
  CODE_SEARCH_RESTRICTED_EXEC_TOOL,
  buildCodeSearchToolSchemas,
  isCodeSearchCommandType,
} from './tool-schema.js';
import { CODE_SEARCH_WORKFLOW_PROMPT, formatCodeSearchSystemPrompt } from './code-search-system-prompt.js';

const BUDGET = { maxTurns: 3, maxCommands: 8, maxResults: 10 };

describe('buildCodeSearchSystemPrompt', () => {
  it('substitutes every budget placeholder', () => {
    const prompt = buildCodeSearchSystemPrompt(BUDGET);
    expect(prompt).not.toContain('{max_turns}');
    expect(prompt).not.toContain('{max_commands}');
    expect(prompt).not.toContain('{max_results}');
    expect(prompt).toContain('at most 3 turns');
    expect(prompt).toContain('at most 8 commands');
    expect(prompt).toContain('at most 10 files');
  });

  it('carries the binary-verified sections verbatim', () => {
    const prompt = buildCodeSearchSystemPrompt(BUDGET);
    for (const section of [
      '# IMPORTANT:',
      '# ENVIRONMENT',
      '# THINKING RULES',
      '# FAST-SEARCH DEFAULTS (optimize rg/tree on large repos)',
      '# SOME EXAMPLES OF WORKFLOWS',
      '# TOOL USE GUIDELINES',
      '# ANSWER FORMAT (strict format, including tags)',
    ]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).toContain('You are an expert software engineer, responsible for providing context');
    expect(prompt).toContain('Working directory: /codebase');
    expect(prompt).toContain('You must use a SINGLE restricted_exec call in your answer');
    expect(prompt).toContain('DO NOT EVER USE MORE THAN 8 commands in a single turn');
    expect(prompt).toContain('[TOOL_CALLS]restricted_exec[ARGS]');
    expect(prompt).toContain('<range>10-60</range>');
    expect(prompt).toContain('The line ranges must be inclusive.');
  });

  it('keeps the fork-only tail sections that the binary lacks', () => {
    // Wording is fork-derived; behavior is corroborated by recorded 0-file results.
    const prompt = buildCodeSearchSystemPrompt(BUDGET);
    expect(prompt).toContain('# NO RESULTS POLICY');
    expect(prompt).toContain('<ANSWER></ANSWER>');
    expect(prompt).toContain('# RESULT COUNT');
  });

  it('defaults to 3 turns and 8 commands', () => {
    const prompt = buildCodeSearchSystemPrompt(BUDGET);
    expect(prompt).toContain('at most 3 turns');
    expect(prompt).toContain('at most 8 commands');
  });
});

describe('buildCodeSearchUserMessage', () => {
  it('lays out problem statement, answer instruction and repo map', () => {
    const message = buildCodeSearchUserMessage({
      query: 'where is the feed redirect handled',
      repoMap: '/codebase\n├── src',
      depth: 3,
    });
    expect(message).toBe(
      [
        'Problem Statement: where is the feed redirect handled',
        CODE_SEARCH_ANSWER_INSTRUCTION,
        '',
        'Repo Map (tree -L 3 /codebase):',
        '```text',
        '/codebase\n├── src',
        '```',
      ].join('\n'),
    );
  });

  it('uses the binary-verified answer instruction', () => {
    expect(CODE_SEARCH_ANSWER_INSTRUCTION).toBe(
      'Find all code in the repository relevant to this, and answer with the file paths and line ranges as instructed.',
    );
  });
});

describe('CODE_SEARCH_FORCE_ANSWER', () => {
  it('matches the binary wording', () => {
    expect(CODE_SEARCH_FORCE_ANSWER).toBe(
      "You have no turns left. Now you MUST provide your final ANSWER, even if it's not complete.",
    );
  });
});

describe('buildCodeSearchToolSchemas', () => {
  it('names the two subagent tools as Devin does', () => {
    const schemas = buildCodeSearchToolSchemas(8);
    expect(schemas.map((schema) => schema.name)).toEqual([
      CODE_SEARCH_RESTRICTED_EXEC_TOOL,
      CODE_SEARCH_ANSWER_TOOL,
    ]);
    expect(schemas[0]?.description).toBe(
      'Execute restricted commands (rg, readfile, tree, ls, glob) in parallel.',
    );
    expect(schemas[1]?.description).toBe('Final answer with relevant files and line ranges.');
  });

  it('offers command1..N slots with only command1 required', () => {
    const restricted = buildCodeSearchToolSchemas(8)[0];
    const parameters = restricted?.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(parameters.properties)).toEqual([
      'command1',
      'command2',
      'command3',
      'command4',
      'command5',
      'command6',
      'command7',
      'command8',
    ]);
    expect(parameters.required).toEqual(['command1']);
  });

  it('accepts all five command types in the union while the description names three', () => {
    type CommandSlot = {
      description: string;
      oneOf: Array<{ properties: { type: { const: string } } }>;
    };
    const parameters = buildCodeSearchToolSchemas(1)[0]?.parameters as {
      properties: Record<string, CommandSlot>;
    };
    const command1 = parameters.properties.command1;
    expect((command1?.oneOf ?? []).map((branch) => branch.properties.type.const)).toEqual([
      'rg',
      'readfile',
      'tree',
      'ls',
      'glob',
    ]);
    // The Devin quirk is preserved on purpose.
    expect(command1?.description).toBe('Command 1 to execute. Must be one of: rg, readfile, or tree.');
  });

  it('requires 1-indexed line ranges on readfile', () => {
    const restricted = buildCodeSearchToolSchemas(1)[0];
    const parameters = restricted?.parameters as {
      properties: Record<
        string,
        { oneOf: Array<{ properties: Record<string, { description?: string }>; required: string[] }> }
      >;
    };
    const readfile = (parameters.properties.command1?.oneOf ?? [])[1];
    expect(readfile?.required).toEqual(['type', 'file']);
    expect(readfile?.properties.start_line?.description).toBe('Starting line number (1-indexed).');
  });

  it('clamps a nonsensical command budget to at least one slot', () => {
    const parameters = buildCodeSearchToolSchemas(0)[0]?.parameters as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(parameters.properties)).toEqual(['command1']);
  });

  it('exposes the command type guard', () => {
    for (const type of CODE_SEARCH_COMMAND_TYPES) {
      expect(isCodeSearchCommandType(type)).toBe(true);
    }
    expect(isCodeSearchCommandType('sed')).toBe(false);
    expect(isCodeSearchCommandType(undefined)).toBe(false);
  });
});

describe('formatCodeSearchSystemPrompt', () => {
  it('injects the verbatim prefer-first rule when code_search is registered', () => {
    const prompt = formatCodeSearchSystemPrompt([
      { descriptor: { name: 'code_search', description: '', parameters: {} } },
    ]);
    expect(prompt).toBe(CODE_SEARCH_WORKFLOW_PROMPT);
    expect(prompt).toContain(
      'you should use the code_search tool first instead of running search commands',
    );
    expect(prompt).toContain('IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.');
  });

  it('accepts either a registration or a bare descriptor', () => {
    expect(formatCodeSearchSystemPrompt([{ name: 'code_search' }])).toBe(CODE_SEARCH_WORKFLOW_PROMPT);
  });

  it('stays silent when the tool is absent', () => {
    expect(formatCodeSearchSystemPrompt([{ name: 'bash' }, { name: 'grep' }])).toBeUndefined();
    expect(formatCodeSearchSystemPrompt([])).toBeUndefined();
  });
});
