import { describe, expect, it } from 'vitest';
import {
  boundToolOutput,
  buildToolPresentation,
  classifyToolKind,
  redactToolText,
} from './tool-presentation.js';

describe('classifyToolKind', () => {
  it('classifies known tools without inventing from substrings', () => {
    expect(classifyToolKind('bash')).toBe('shell');
    expect(classifyToolKind('read')).toBe('filesystem');
    expect(classifyToolKind('git_status')).toBe('git');
    expect(classifyToolKind('web_search')).toBe('web');
    expect(classifyToolKind('mcp__server__tool')).toBe('mcp');
    expect(classifyToolKind('mystery_tool')).toBe('other');
    // Must not treat a random name containing "file" as filesystem.
    expect(classifyToolKind('profile_loader')).toBe('other');
  });
});

describe('buildToolPresentation', () => {
  it('builds shell presentation with command and exit code', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      args: { command: 'ls -la' },
      outputText: 'README.md',
      exitCode: 0,
    });
    expect(presentation.kind).toBe('shell');
    expect(presentation.command).toBe('ls -la');
    expect(presentation.exitCode).toBe(0);
    expect(presentation.output?.text).toContain('README');
  });

  it('builds filesystem presentation with target paths', () => {
    const presentation = buildToolPresentation({
      toolName: 'read',
      args: { path: 'src/App.tsx' },
    });
    expect(presentation.kind).toBe('filesystem');
    expect(presentation.targetPaths).toEqual(['src/App.tsx']);
  });

  it('redacts secrets in output', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      args: { command: 'echo hi' },
      outputText: 'api_key=sk-abcdefghijklmnopqrstuvwxyz',
      isError: false,
    });
    expect(presentation.output?.text).toContain('[redacted]');
    expect(presentation.output?.redacted).toBe(true);
  });

  it('marks errors', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      isError: true,
      outputText: 'command failed',
    });
    expect(presentation.error?.category).toBe('execution');
  });

  it('extracts actionVerb, lineRange and countTag for search/view tools', () => {
    const presentation = buildToolPresentation({
      toolName: 'grep_search',
      args: { Query: 'TurnToolGroup', StartLine: 1, EndLine: 90 },
      outputText: JSON.stringify([{ file: 'turn-tool-group.tsx' }, { file: 'turn-work-details.tsx' }]),
    });
    expect(presentation.actionVerb).toBe('Searched');
    expect(presentation.lineRange).toBe('L1-90');
    expect(presentation.countTag).toBe('2 results');
  });
});

describe('redactToolText / boundToolOutput', () => {
  it('bounds very long output', () => {
    const long = 'x'.repeat(20_000);
    const bounded = boundToolOutput(long);
    expect(bounded.truncated).toBe(true);
    expect(bounded.text.length).toBeLessThan(long.length);
  });

  it('redacts bearer tokens', () => {
    const result = redactToolText('Authorization: Bearer abcdefghijklmnop');
    expect(result.redacted).toBe(true);
    expect(result.text).toContain('[redacted]');
  });
});
