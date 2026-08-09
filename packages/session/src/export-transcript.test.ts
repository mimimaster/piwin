import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  TOOL_OUTPUT_REDACTED_PLACEHOLDER,
  exportTranscript,
  streamTranscriptExport,
  suggestSessionExportBasename,
} from './export-transcript.js';
import { exportCompactionMarkdown, suggestCompactionExportBasename } from './export-compaction.js';

function sampleMessages(): SessionTranscriptMessage[] {
  return [
    {
      id: 'u1',
      role: 'user',
      text: 'Please list files',
      createdAt: '2026-07-21T10:00:00.000Z',
      status: 'done',
    },
    {
      id: 'a1',
      role: 'assistant',
      text: 'I will list the directory.',
      createdAt: '2026-07-21T10:00:01.000Z',
      status: 'done',
      thinking: 'Need bash ls',
      tools: [
        {
          toolCallId: 'tc1',
          toolName: 'bash',
          status: 'done',
          output: 'secret-token=abc\nREADME.md',
        },
      ],
    },
  ];
}

describe('exportTranscript', () => {
  it.each(['md', 'html'] as const)(
    'streams %s with exact array-renderer parity',
    async (format) => {
      const messages = sampleMessages();
      const options = {
        format,
        sessionId: 'stream-parity',
        projectPath: '/tmp/demo',
        exportedAt: '2026-07-21T12:00:00.000Z',
      };
      const chunks: string[] = [];
      async function* source(): AsyncIterable<SessionTranscriptMessage> {
        for (const message of messages) yield message;
      }
      for await (const chunk of streamTranscriptExport(source(), options)) {
        chunks.push(chunk);
      }
      expect(chunks.join('')).toBe(exportTranscript(messages, options).content);
    },
  );

  it('exports Markdown matching user/assistant transcript text', () => {
    const result = exportTranscript(sampleMessages(), {
      format: 'md',
      sessionId: 'sess-12345678-abcd',
      projectPath: '/tmp/demo',
      exportedAt: '2026-07-21T12:00:00.000Z',
    });

    expect(result.format).toBe('md');
    expect(result.redactTools).toBe(false);
    expect(result.content).toContain('# Session export (sess-123)');
    expect(result.content).toContain('**Session:** `sess-12345678-abcd`');
    expect(result.content).toContain('**Project:** `/tmp/demo`');
    expect(result.content).toContain('### User');
    expect(result.content).toContain('Please list files');
    expect(result.content).toContain('### Assistant');
    expect(result.content).toContain('I will list the directory.');
    expect(result.content).toContain('#### Thinking');
    expect(result.content).toContain('Need bash ls');
    expect(result.content).toContain('`bash` (done)');
    expect(result.content).toContain('secret-token=abc');
    expect(result.content).not.toContain(TOOL_OUTPUT_REDACTED_PLACEHOLDER);
  });

  it('redacts tool outputs when redactTools is true', () => {
    const result = exportTranscript(sampleMessages(), {
      format: 'md',
      redactTools: true,
      sessionId: 'sess-redact',
      exportedAt: '2026-07-21T12:00:00.000Z',
    });

    expect(result.redactTools).toBe(true);
    expect(result.content).toContain('**Tool output:** redacted');
    expect(result.content).toContain(TOOL_OUTPUT_REDACTED_PLACEHOLDER);
    expect(result.content).not.toContain('secret-token=abc');
    // User/assistant text still present
    expect(result.content).toContain('Please list files');
    expect(result.content).toContain('I will list the directory.');
  });

  it('exports HTML with escaped content and optional tool redaction', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'Compare <a> vs &',
        createdAt: '2026-07-21T10:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'ok',
        createdAt: '2026-07-21T10:00:01.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'read',
            status: 'done',
            output: '<script>alert(1)</script>',
          },
        ],
      },
    ];

    const plain = exportTranscript(messages, {
      format: 'html',
      sessionId: 'html-1',
      exportedAt: '2026-07-21T12:00:00.000Z',
    });
    expect(plain.content).toContain('<!DOCTYPE html>');
    expect(plain.content).toContain('Compare &lt;a&gt; vs &amp;');
    expect(plain.content).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    const redacted = exportTranscript(messages, {
      format: 'html',
      redactTools: true,
      sessionId: 'html-1',
      exportedAt: '2026-07-21T12:00:00.000Z',
    });
    expect(redacted.content).toContain(TOOL_OUTPUT_REDACTED_PLACEHOLDER);
    expect(redacted.content).not.toContain('alert(1)');
  });

  it('handles empty transcript', () => {
    const result = exportTranscript([], {
      format: 'md',
      sessionId: 'empty',
      exportedAt: '2026-07-21T12:00:00.000Z',
    });
    expect(result.content).toContain('_(empty transcript)_');
  });

  it('suggests stable export basenames', () => {
    expect(suggestSessionExportBasename('abcdef01-rest', 'md')).toBe('piwin-export-abcdef01.md');
    expect(suggestSessionExportBasename('abcdef01-rest', 'html')).toBe(
      'piwin-export-abcdef01.html',
    );
  });

  it('renders only the compact summary for a new session handoff', () => {
    const content = exportCompactionMarkdown({
      summary: 'Implemented the auth fix and verified the login path.',
    });

    expect(content).toBe('Implemented the auth fix and verified the login path.\n');
    expect(content).not.toContain('Source:');
    expect(content).not.toContain('Tokens:');
    expect(content.endsWith('\n')).toBe(true);
    expect(suggestCompactionExportBasename('abcdef01-rest')).toBe('piwin-compact-abcdef01.md');
  });
});
