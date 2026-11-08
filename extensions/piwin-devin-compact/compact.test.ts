import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import compactExtension, {
  DEVIN_CONVERSATION_PREFIX,
  DEVIN_SUMMARIZE_INSTRUCTION,
  DEVIN_SUMMARIZER_SYSTEM,
  DEVIN_TRANSCRIPT_LIMIT_BYTES,
  buildSummarizerMessages,
  devinMessageHeader,
  devinOmittedMarker,
  elideTranscript,
  renderEditedFilesBlock,
  renderMessages,
  renderReplacementMessage,
  truncateMessageText,
  resolveCompactRoot,
  summarizeWithModel,
  toRenderedMessage,
  writeHistoryFile,
} from './index.js';
import type { RenderedMessage } from './transcript.js';

const ENV_ROOT = process.env.PIWIN_ROOT;

beforeEach(() => {
  delete process.env.PIWIN_ROOT;
});

afterEach(() => {
  if (ENV_ROOT === undefined) delete process.env.PIWIN_ROOT;
  else process.env.PIWIN_ROOT = ENV_ROOT;
});

type Handler = (...args: unknown[]) => unknown;

function collectHandlers(): {
  handlers: Map<string, Handler>;
  tools: Array<{ name: string }>;
  commands: Array<{ name: string; handler: (args: string, ctx: unknown) => Promise<void> | void }>;
} {
  const handlers = new Map<string, Handler>();
  const tools: Array<{ name: string }> = [];
  const commands: Array<{ name: string; handler: (args: string, ctx: unknown) => Promise<void> | void }> = [];
  compactExtension({
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    registerTool: (tool) => {
      tools.push({ name: tool.name });
    },
    registerCommand: (name, options) => {
      commands.push({ name, handler: options.handler });
    },
  });
  return { handlers, tools, commands };
}

function userMessage(text: string) {
  return { role: 'user', content: [{ type: 'text', text }] };
}

describe('Devin prompt strings (recovered verbatim)', () => {
  it('keeps the exact summarizer prompt shape', () => {
    expect(DEVIN_SUMMARIZER_SYSTEM.startsWith('\n            You are a Summarizer that summarizes conversation history.')).toBe(true);
    expect(DEVIN_SUMMARIZER_SYSTEM).toContain('<summary>\n## Overview');
    expect(DEVIN_SUMMARIZER_SYSTEM).toContain('## Key Details & Breadcrumbs');
    expect(DEVIN_SUMMARIZER_SYSTEM).toContain('## Current State');
    expect(DEVIN_SUMMARIZER_SYSTEM).toContain('history file ({historyFile})');
    expect(DEVIN_SUMMARIZER_SYSTEM.endsWith('only your summary plus the reference file.')).toBe(true);
    expect(DEVIN_SUMMARIZER_SYSTEM).toContain('Rules will be re-discovered and re-injected');
  });

  it('keeps the exact 140-byte instruction turn', () => {
    expect(DEVIN_SUMMARIZE_INSTRUCTION).toBe(
      'Now summarize the conversation above as per the format given. Remember, do NOT take any actions. Just provide the summary in <summary> tags.',
    );
    expect(Buffer.byteLength(DEVIN_SUMMARIZE_INSTRUCTION, 'utf8')).toBe(140);
  });

  it('keeps the conversation wrapper and marker wording', () => {
    expect(DEVIN_CONVERSATION_PREFIX).toBe('\nConversation to summarize:\n');
    expect(devinOmittedMarker(34)).toBe('[... 34 messages omitted due to length ...]');
    expect(devinMessageHeader(7, 'Tool')).toBe('=== MESSAGE 7 - Tool ===');
  });
});

describe('transcript rendering', () => {
  it('renders roles Devin-style and drops tool call arguments', () => {
    const assistant = toRenderedMessage({
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
      ],
    });
    expect(assistant).toEqual({ role: 'Assistant', text: '' });

    const tool = toRenderedMessage({
      role: 'toolResult',
      content: [{ type: 'text', text: 'file-a\nfile-b' }],
    });
    expect(tool).toEqual({ role: 'Tool', text: 'file-a\nfile-b' });

    expect(toRenderedMessage(userMessage('hi'))).toEqual({ role: 'User', text: 'hi' });
    expect(toRenderedMessage({ role: 'system', content: 'rules' })).toEqual({
      role: 'System',
      text: 'rules',
    });
  });

  it('joins messages with a blank line and keeps a running index', () => {
    const text = renderMessages([
      { role: 'System', text: 'a' },
      { role: 'User', text: 'b' },
    ]);
    expect(text).toBe('=== MESSAGE 0 - System ===\na\n\n=== MESSAGE 1 - User ===\nb');
  });
});

describe('per-message truncation (Devin 8000-byte cap)', () => {
  it('leaves short content untouched', () => {
    const text = 'x'.repeat(8000);
    expect(truncateMessageText(text)).toBe(text);
  });

  it('keeps 4000 bytes on each side and reports the remainder', () => {
    const text = `${'a'.repeat(4000)}${'b'.repeat(1968)}${'c'.repeat(4000)}`;
    const out = truncateMessageText(text);
    expect(out.startsWith('a'.repeat(4000))).toBe(true);
    expect(out).toContain('...[1968 chars truncated]...');
    expect(out.endsWith('c'.repeat(4000))).toBe(true);
  });

  it('never splits a UTF-8 sequence', () => {
    const text = `${'中'.repeat(2000)}${'文'.repeat(2000)}`;
    const out = truncateMessageText(text);
    expect(out).toContain('chars truncated');
    expect(out).not.toContain('\ufffd');
    expect(Buffer.from(out, 'utf8').toString('utf8')).toBe(out);
  });

  it('is applied when a message is rendered', () => {
    const rendered = toRenderedMessage({
      role: 'toolResult',
      content: [{ type: 'text', text: 'z'.repeat(9000) }],
    });
    expect(rendered?.text).toContain('...[1000 chars truncated]...');
  });
});

describe('middle elision (Devin byte rule)', () => {
  const make = (count: number, size: number): RenderedMessage[] =>
    Array.from({ length: count }, (_, index) => ({
      role: index % 2 === 0 ? 'User' : 'Assistant',
      text: 'x'.repeat(size),
    }));

  it('does not elide below 200001 joined bytes', () => {
    const messages = make(10, 100);
    const result = elideTranscript(messages);
    expect(result.omitted).toBe(0);
    expect(result.text).not.toContain('omitted due to length');
  });

  it('keeps the first half and the last quarter once the transcript is long enough', () => {
    const messages = make(131, 2000);
    const result = elideTranscript(messages);
    expect(result.omitted).toBe(34);
    expect(result.text).toContain(devinOmittedMarker(34));
    const indices = [...result.text.matchAll(/=== MESSAGE (\d+) - /g)].map((match) => Number(match[1]));
    expect(indices.length).toBe(97);
    expect(indices[0]).toBe(0);
    expect(indices[64]).toBe(64);
    expect(indices[65]).toBe(99);
    expect(indices.at(-1)).toBe(130);
    expect(Buffer.byteLength(renderMessages(messages), 'utf8')).toBeGreaterThanOrEqual(
      DEVIN_TRANSCRIPT_LIMIT_BYTES,
    );
  });
});

describe('replacement message', () => {
  it('matches the recovered Devin layout including edited files', () => {
    const message = renderReplacementMessage({
      historyPath: '/tmp/history_ab12cd34ef567890.md',
      summary: '<summary>\n## Overview\nx\n</summary>\n',
      editedPaths: ['/repo/a.ts', '/repo/b.ts'],
    });
    expect(message.startsWith('You are continuing work from a previous conversation thread. Below is a summary of the previous conversation thread:\nFull conversation history saved at /tmp/history_ab12cd34ef567890.md.\nSummary:\n<summary>')).toBe(true);
    expect(message.endsWith(
      '\nHere are some files that you edited (and perhaps there were others which were touched via shell script):\n - /repo/a.ts\n - /repo/b.ts\n',
    )).toBe(true);
  });

  it('omits the edited-files block when nothing was edited', () => {
    const message = renderReplacementMessage({
      historyPath: '/tmp/history_x.md',
      summary: 'S',
      editedPaths: [],
    });
    expect(message).toBe(
      'You are continuing work from a previous conversation thread. Below is a summary of the previous conversation thread:\nFull conversation history saved at /tmp/history_x.md.\nSummary:\nS',
    );
  });

  it('renders the edited files block verbatim', () => {
    expect(renderEditedFilesBlock([])).toBe('');
    expect(renderEditedFilesBlock(['/a'])).toBe(
      '\nHere are some files that you edited (and perhaps there were others which were touched via shell script):\n - /a\n',
    );
  });
});

describe('summarizer request', () => {
  it('builds the three Devin turns with the bare history file name', () => {
    const messages = buildSummarizerMessages({
      historyFileName: 'history_ab12cd34ef567890.md',
      transcript: 'BODY',
    }) as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(3);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('(history_ab12cd34ef567890.md)');
    expect(messages[1]?.content).toBe('\nConversation to summarize:\nBODY');
    expect(messages[2]?.content).toBe(DEVIN_SUMMARIZE_INSTRUCTION);
  });

  it('returns the model text and drops empty output', async () => {
    const ok = await summarizeWithModel(
      { complete: async () => ({ content: [{ type: 'text', text: ' <summary>x</summary> ' }] }) },
      { id: 'm' },
      { historyFileName: 'history_a.md', transcript: 'T' },
    );
    expect(ok).toBe('<summary>x</summary>');

    const empty = await summarizeWithModel(
      { complete: async () => ({ content: [] }) },
      { id: 'm' },
      { historyFileName: 'history_a.md', transcript: 'T' },
    );
    expect(empty).toBeUndefined();
  });
});

describe('archive', () => {
  it('writes history_<16 hex>.md and honours PIWIN_ROOT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-compact-'));
    process.env.PIWIN_ROOT = dir;
    try {
      expect(resolveCompactRoot()).toBe(join(dir, 'compact'));
      const archived = await writeHistoryFile(resolveCompactRoot(), 'BODY');
      expect(archived.fileName).toMatch(/^history_[0-9a-f]{16}\.md$/);
      expect(await readFile(archived.filePath, 'utf8')).toBe('BODY');
      expect(await readdir(join(dir, 'compact'))).toContain(archived.fileName);
    } finally {
      delete process.env.PIWIN_ROOT;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('extension wiring', () => {
  it('registers the compact tool and the /compact command', () => {
    const { tools, commands } = collectHandlers();
    expect(tools.map((tool) => tool.name)).toContain('compact');
    expect(commands.map((command) => command.name)).toContain('compact');
  });

  it('compacts through the model and returns the Devin continuation message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-compact-'));
    process.env.PIWIN_ROOT = dir;
    try {
      const { handlers } = collectHandlers();
      const handler = handlers.get('session_before_compact');
      expect(handler).toBeTypeOf('function');
      const seen: Array<{ messages: Array<{ role: string; content: string }> }> = [];
      const result = (await handler?.(
        {
          preparation: {
            messagesToSummarize: [userMessage('do the thing'), { role: 'assistant', content: [] }],
            turnPrefixMessages: [],
            firstKeptEntryId: 'entry-42',
            tokensBefore: 1234,
          },
          signal: new AbortController().signal,
        },
        {
          cwd: '/repo',
          model: { id: 'model-x' },
          modelRegistry: {
            complete: async (_model: unknown, context: unknown) => {
              seen.push(context as { messages: Array<{ role: string; content: string }> });
              return { content: [{ type: 'text', text: '<summary>ok</summary>' }] };
            },
          },
        },
      )) as { compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number } };

      expect(seen).toHaveLength(1);
      expect(seen[0]?.messages[1]?.content).toBe(
        '\nConversation to summarize:\n=== MESSAGE 0 - User ===\ndo the thing\n\n=== MESSAGE 1 - Assistant ===\n',
      );
      expect(result.compaction.firstKeptEntryId).toBe('entry-42');
      expect(result.compaction.tokensBefore).toBe(1234);
      expect(result.compaction.summary).toContain('You are continuing work from a previous conversation thread.');
      expect(result.compaction.summary).toContain('<summary>ok</summary>');
      expect(result.compaction.summary).toContain('/history_');
    } finally {
      delete process.env.PIWIN_ROOT;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the default compaction when the summarizer throws', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devin-compact-'));
    process.env.PIWIN_ROOT = dir;
    try {
      const { handlers } = collectHandlers();
      const handler = handlers.get('session_before_compact');
      const result = await handler?.(
        {
          preparation: {
            messagesToSummarize: [userMessage('x')],
            firstKeptEntryId: 'e1',
          },
          signal: new AbortController().signal,
        },
        {
          cwd: '/repo',
          model: { id: 'model-x' },
          modelRegistry: {
            complete: async () => {
              throw new Error('boom');
            },
          },
          ui: { notify: () => undefined },
        },
      );
      expect(result).toBeUndefined();
    } finally {
      delete process.env.PIWIN_ROOT;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('tracks edited files from edit/write tool ends', async () => {
    const { handlers } = collectHandlers();
    const handler = handlers.get('tool_execution_end');
    handler?.({ toolName: 'edit', input: { path: '/repo/a.ts' } }, { cwd: '/repo' });
    handler?.({ toolName: 'edit', input: { path: '/repo/a.ts' } }, { cwd: '/repo' });
    handler?.({ toolName: 'read', input: { path: '/repo/b.ts' } }, { cwd: '/repo' });
    handler?.({ toolName: 'write', args: { file_path: '/repo/c.ts' } }, { cwd: '/repo' });

    const dir = await mkdtemp(join(tmpdir(), 'devin-compact-'));
    process.env.PIWIN_ROOT = dir;
    try {
      const compact = handlers.get('session_before_compact');
      const result = (await compact?.(
        {
          preparation: {
            messagesToSummarize: [userMessage('x')],
            firstKeptEntryId: 'e1',
          },
          signal: new AbortController().signal,
        },
        {
          cwd: '/repo',
          model: { id: 'm' },
          modelRegistry: {
            complete: async () => ({ content: [{ type: 'text', text: '<summary>s</summary>' }] }),
          },
        },
      )) as { compaction: { summary: string } };
      expect(result.compaction.summary).toContain(' - /repo/a.ts\n');
      expect(result.compaction.summary).toContain(' - /repo/c.ts\n');
      expect(result.compaction.summary).not.toContain('/repo/b.ts');
    } finally {
      delete process.env.PIWIN_ROOT;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
