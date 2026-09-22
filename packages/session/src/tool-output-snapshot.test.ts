import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  findToolCard,
  isReadFamilyTool,
  readToolOutputSnapshot,
  TOOL_SNAPSHOT_HARD_MAX_BYTES,
} from './tool-output-snapshot.js';

function readMessage(overrides: Partial<SessionTranscriptMessage> = {}): SessionTranscriptMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: '',
    createdAt: new Date().toISOString(),
    status: 'done',
    ...overrides,
  };
}

describe('readToolOutputSnapshot', () => {
  it('returns a ready tool-snapshot for a read_file tool', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-1',
          toolName: 'read_file',
          status: 'done',
          output: '# hello\n\nworld',
        },
      ],
    });
    expect(readToolOutputSnapshot({ message, toolCallId: 'tc-1' })).toEqual({
      status: 'ready',
      output: '# hello\n\nworld',
      truncated: false,
      redacted: false,
      provenance: 'tool-snapshot',
    });
  });

  it('prefers presentation.output over the raw tool output', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-1',
          toolName: 'read',
          status: 'done',
          output: 'raw output',
          presentation: {
            kind: 'filesystem',
            title: 'Read file',
            output: { text: 'presentation output' },
          },
        },
      ],
    });
    const snapshot = readToolOutputSnapshot({ message, toolCallId: 'tc-1' });
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.output).toBe('presentation output');
    }
  });

  it('reports not-found for an unknown tool call', () => {
    const message = readMessage();
    expect(readToolOutputSnapshot({ message, toolCallId: 'missing' })).toEqual({
      status: 'unavailable',
      reason: 'not-found',
    });
  });

  it('returns persisted output for bash/shell tools (expanded historical rows)', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-bash',
          toolName: 'bash',
          status: 'done',
          output: 'total 0\ndrwxr-xr-x  2 me  wheel  64 tmp',
        },
      ],
    });
    const snapshot = readToolOutputSnapshot({ message, toolCallId: 'tc-bash' });
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.output).toContain('drwxr-xr-x');
    }
  });

  it('still reports not-readable-tool for web tools', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-web',
          toolName: 'web_fetch',
          status: 'done',
          output: '<html>',
        },
      ],
    });
    expect(readToolOutputSnapshot({ message, toolCallId: 'tc-web' })).toEqual({
      status: 'unavailable',
      reason: 'not-readable-tool',
    });
  });

  it('reports snapshot-unavailable for an empty read output', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-empty',
          toolName: 'read',
          status: 'done',
          output: '',
        },
      ],
    });
    expect(readToolOutputSnapshot({ message, toolCallId: 'tc-empty' })).toEqual({
      status: 'unavailable',
      reason: 'snapshot-unavailable',
    });
  });

  it('truncates oversized output with a marker', () => {
    const big = 'a'.repeat(10_000);
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-big',
          toolName: 'read',
          status: 'done',
          output: big,
        },
      ],
    });
    const snapshot = readToolOutputSnapshot({ message, toolCallId: 'tc-big', maxBytes: 2048 });
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.truncated).toBe(true);
      expect(snapshot.output.endsWith('[output truncated]')).toBe(true);
      expect(snapshot.output.length).toBeLessThan(big.length);
    }
  });

  it('honors the hard byte ceiling regardless of caller maxBytes', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-huge',
          toolName: 'read',
          status: 'done',
          output: 'b'.repeat(2 * 1024 * 1024),
        },
      ],
    });
    const snapshot = readToolOutputSnapshot({
      message,
      toolCallId: 'tc-huge',
      maxBytes: 10 * 1024 * 1024,
    });
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(Buffer.byteLength(snapshot.output, 'utf8')).toBeLessThanOrEqual(
        TOOL_SNAPSHOT_HARD_MAX_BYTES + 64,
      );
    }
  });

  it('marks redacted when presentation output was redacted', () => {
    const message = readMessage({
      tools: [
        {
          toolCallId: 'tc-redacted',
          toolName: 'read',
          status: 'done',
          output: 'secret content',
          presentation: {
            kind: 'filesystem',
            title: 'Read file',
            output: { text: '[redacted]', redacted: true },
          },
        },
      ],
    });
    const snapshot = readToolOutputSnapshot({ message, toolCallId: 'tc-redacted' });
    expect(snapshot.status).toBe('ready');
    if (snapshot.status === 'ready') {
      expect(snapshot.redacted).toBe(true);
    }
  });
});

describe('findToolCard / isReadFamilyTool', () => {
  it('finds the tool card by toolCallId', () => {
    const message = readMessage({
      tools: [
        { toolCallId: 'tc-a', toolName: 'read', status: 'done', output: 'a' },
        { toolCallId: 'tc-b', toolName: 'bash', status: 'done', output: 'b' },
      ],
    });
    expect(findToolCard(message, 'tc-b')?.toolName).toBe('bash');
    expect(findToolCard(message, 'missing')).toBeNull();
  });

  it('classifies read-like tool names as read family', () => {
    for (const name of ['read', 'read_file', 'view', 'view_file', 'open_file', 'read_multi', 'list_read']) {
      expect(isReadFamilyTool({ toolName: name })).toBe(true);
    }
  });

  it('rejects edit/search/shell tool names', () => {
    for (const name of ['edit', 'apply_patch', 'grep', 'bash', 'write_file', 'web_search']) {
      expect(isReadFamilyTool({ toolName: name })).toBe(false);
    }
  });

  it('accepts read-like action verbs', () => {
    expect(
      isReadFamilyTool({
        toolName: 'custom_reader',
        presentation: { kind: 'filesystem', title: 't', actionVerb: 'Read file' },
      }),
    ).toBe(true);
  });
});
