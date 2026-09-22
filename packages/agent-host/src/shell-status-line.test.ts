import { describe, expect, it } from 'vitest';
import { buildToolPresentation, parseShellStatusLine } from './tool-presentation.js';
import { mapToolExecutionEndEvent } from './tool-event-map.js';

describe('parseShellStatusLine', () => {
  it('reads the trailing status line Pi appends to bash output', () => {
    expect(parseShellStatusLine('FAIL a.test.ts\n\nCommand exited with code 1\n')).toEqual({
      kind: 'exit',
      code: 1,
      line: 'Command exited with code 1',
    });
    expect(parseShellStatusLine('ready\nCommand timed out after 120 seconds')).toMatchObject({
      kind: 'timeout',
    });
    expect(parseShellStatusLine('partial\nCommand aborted')).toMatchObject({ kind: 'aborted' });
    expect(parseShellStatusLine('Command exited with code 1 was printed by the script\nok')).toBeNull();
  });
});

describe('shell failures', () => {
  const failedOutput = [' RUN  v3.2.4', ' FAIL  src/a.test.ts', '', 'Command exited with code 1'].join(
    '\n',
  );

  it('names the failure by its status line, not the head of stdout', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      isError: true,
      args: { command: 'pnpm vitest run' },
      outputText: failedOutput,
    });
    expect(presentation.error).toEqual({
      category: 'execution',
      message: 'Command exited with code 1',
    });
  });

  it('classifies a timed-out command as a timeout', () => {
    const presentation = buildToolPresentation({
      toolName: 'bash',
      isError: true,
      args: { command: 'pnpm dev:host' },
      outputText: 'host ready\nCommand timed out after 120 seconds',
    });
    expect(presentation.error?.category).toBe('timeout');
  });

  it('derives the exit code on tool end: 0 on success, parsed on failure', () => {
    const [ok] = mapToolExecutionEndEvent({
      toolCallId: 'tc-ok',
      toolName: 'bash',
      args: { command: 'ls' },
      result: { content: [{ type: 'text', text: 'a\nb' }] },
      isError: false,
    });
    const [failed] = mapToolExecutionEndEvent({
      toolCallId: 'tc-fail',
      toolName: 'bash',
      args: { command: 'pnpm vitest run' },
      result: { content: [{ type: 'text', text: failedOutput }] },
      isError: true,
    });
    expect(ok?.type === 'tool/end' ? ok.presentation?.exitCode : 'missing').toBe(0);
    expect(failed?.type === 'tool/end' ? failed.presentation?.exitCode : 'missing').toBe(1);
  });

  it('leaves non-shell tools without an exit code', () => {
    const [read] = mapToolExecutionEndEvent({
      toolCallId: 'tc-read',
      toolName: 'read',
      args: { path: 'a.ts' },
      result: { content: [{ type: 'text', text: 'x' }] },
      isError: false,
    });
    expect(read?.type === 'tool/end' ? read.presentation?.exitCode : 'missing').toBeUndefined();
  });
});
