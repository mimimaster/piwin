import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import compactExtension, {
  COMPACT_BUSY_MESSAGE,
  DEVIN_SUMMARY_INSTRUCTIONS,
  EDITED_FILES_LIMIT,
  createCompactState,
  extractEditedPathFromToolEnd,
  mergePreparationFileOps,
  recordEditedFiles,
  renderCarryoverBlock,
  renderDevinSummary,
  renderTranscriptMarkdown,
  sessionDirFor,
  shouldInjectCarryover,
  type RegisteredTool,
} from './compact/index.js';

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'piwin-compact-ext-'));
  originalEnv = process.env.PIWIN_ROOT;
  process.env.PIWIN_ROOT = tempDir;
});

afterEach(async () => {
  if (originalEnv === undefined) {
    delete process.env.PIWIN_ROOT;
  } else {
    process.env.PIWIN_ROOT = originalEnv;
  }
  await rm(tempDir, { recursive: true, force: true });
});

type Handler = (...args: unknown[]) => unknown;
type FakeCommand = {
  name: string;
  description?: string;
  handler: (args: string, ctx: unknown) => unknown;
};
type FakePi = {
  tools: RegisteredTool[];
  commands: FakeCommand[];
  handlers: Map<string, Handler[]>;
  registerTool: (tool: RegisteredTool) => void;
  registerCommand: (name: string, options: Omit<FakeCommand, 'name'>) => void;
  on: (event: string, handler: Handler) => void;
};

function createFakePi(): FakePi {
  const tools: RegisteredTool[] = [];
  const commands: FakeCommand[] = [];
  const handlers = new Map<string, Handler[]>();
  return {
    tools,
    commands,
    handlers,
    registerTool: (tool) => tools.push(tool),
    registerCommand: (name, options) => commands.push({ name, ...options }),
    on: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
  };
}

const WORKSPACE = '/repo/piwin-demo';
const sessionCtx = { cwd: WORKSPACE };

type ToolOutcome = {
  content: Array<{ type: 'text'; text: string }>;
  details?: Record<string, unknown>;
};

async function fireCompactTool(
  pi: FakePi,
  params: unknown,
  ctx: {
    cwd?: string;
    isIdle?: () => boolean;
    compact?: (options?: unknown) => void;
    getContextUsage?: () => unknown;
    ui?: { notify?: (m: string, t?: string) => void };
  },
): Promise<ToolOutcome> {
  const tool = pi.tools.find((t) => t.name === 'compact');
  if (!tool) throw new Error('compact tool not registered');
  return (await tool.execute('call-1', params, undefined, undefined, {
    cwd: WORKSPACE,
    ...ctx,
  })) as ToolOutcome;
}

describe('bundled compact extension (Devin-style compaction)', () => {
  it('registers the compact tool and the /compact command via Pi (name, options)', () => {
    const pi = createFakePi();
    compactExtension(pi);
    expect(pi.tools.map((t) => t.name)).toContain('compact');
    expect(pi.commands.map((c) => c.name)).toContain('compact');
    expect(typeof pi.commands[0]?.handler).toBe('function');
    const tool = pi.tools.find((t) => t.name === 'compact');
    expect(tool?.promptSnippet).toBeTruthy();
    expect((tool?.promptGuidelines ?? []).length).toBeGreaterThan(0);
    expect(Object.keys(tool?.parameters.properties ?? {})).toContain('focus');
  });

  it('DEVIN_SUMMARY_INSTRUCTIONS carries the Devin <summary> structure and rules', () => {
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('<summary>');
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('## Overview');
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('## Key Details & Breadcrumbs');
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('## Current State');
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('Output the full summary every time');
    expect(DEVIN_SUMMARY_INSTRUCTIONS).toContain('Do NOT reproduce or recite any rules');
  });

  it('compact tool fires even mid-turn (model-called compact is the last action of a phase)', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    let compactCalls = 0;
    const seen: Array<Record<string, unknown>> = [];
    const result = await fireCompactTool(
      pi,
      { focus: 'preserve the migration plan' },
      {
        isIdle: () => false,
        compact: (options) => {
          compactCalls += 1;
          seen.push(options as Record<string, unknown>);
        },
        getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
      },
    );
    expect(result.details?.compact).toBe('started');
    expect(result.content[0]?.text).toContain('Compaction started');
    expect(result.content[0]?.text).toContain('75%');
    expect(compactCalls).toBe(1);
    expect(String(seen[0]?.customInstructions ?? '')).toContain('## Overview');
    expect(String(seen[0]?.customInstructions ?? '')).toContain('preserve the migration plan');
  });

  it('/compact command rejects while the agent is working when waitForIdle is unavailable', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    let compactCalls = 0;
    const notifications: string[] = [];
    await pi.commands[0]?.handler('', {
      cwd: WORKSPACE,
      isIdle: () => false,
      compact: () => {
        compactCalls += 1;
      },
      ui: { notify: (m: string) => notifications.push(m) },
    });
    expect(compactCalls).toBe(0);
    expect(notifications[0]).toBe(COMPACT_BUSY_MESSAGE);
  });

  it('reports when no compact action is bound', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    const result = await fireCompactTool(pi, {}, { isIdle: () => true });
    expect(result.details?.compact).toBe('unavailable');
  });

  it('session_before_compact archives the transcript and returns a Devin <summary>', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    pi.handlers.get('session_start')?.[0]?.({ type: 'session_start' }, sessionCtx);

    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Fix the flaky test' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running the test first.' },
          { type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'pnpm test' } },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'toolu_1',
        toolName: 'bash',
        content: [{ type: 'text', text: '1 failed' }],
        isError: false,
      },
    ];
    const result = (await pi.handlers.get('session_before_compact')?.[0]?.(
      {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'e9',
          messagesToSummarize: messages,
          turnPrefixMessages: [],
          isSplitTurn: false,
          tokensBefore: 182000,
          previousSummary: 'Earlier: set up CI.',
          fileOps: {
            read: new Set(['a.ts']),
            written: new Set<string>(),
            edited: new Set(['src/app.ts']),
          },
          settings: { enabled: true, reserveTokens: 20000, keepRecentTokens: 20000 },
        },
        reason: 'threshold',
        willRetry: false,
      },
      sessionCtx,
    )) as { compaction: { summary: string; firstKeptEntryId: string; tokensBefore: number } };

    expect(result.compaction.firstKeptEntryId).toBe('e9');
    expect(result.compaction.tokensBefore).toBe(182000);
    expect(result.compaction.summary).toContain('<summary>');
    expect(result.compaction.summary).toContain('## Overview');
    expect(result.compaction.summary).toContain('Fix the flaky test');
    expect(result.compaction.summary).toContain('src/app.ts');
    expect(result.compaction.summary).toContain('[m2]');

    const dir = sessionDirFor(WORKSPACE, join(tempDir, 'compact'));
    const files = await readdir(dir);
    const historyName = files.find((f) => f.endsWith('.md'));
    expect(historyName).toBeTruthy();
    const history = await readFile(join(dir, historyName!), 'utf8');
    expect(history).toContain('# Compacted conversation transcript');
    expect(history).toContain('- tokens before compaction: 182000');
    expect(history).toContain('Earlier: set up CI.');
    expect(history).toContain('### [m1] user');
    expect(history).toContain('### [m2] assistant');
    expect(history).toContain('#### [m2.bash] bash (toolu_1)');
    expect(history).toContain('"command"');
    expect(result.compaction.summary).toContain(join(dir, historyName!));
  });

  it('logs compaction as JSONL and notifies on session_compact', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    pi.handlers.get('session_start')?.[0]?.({ type: 'session_start' }, sessionCtx);
    await pi.handlers.get('session_before_compact')?.[0]?.(
      {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'e1',
          messagesToSummarize: [{ role: 'user', content: 'hello' }],
          tokensBefore: 1000,
        },
        reason: 'manual',
        willRetry: false,
      },
      sessionCtx,
    );
    const notifications: string[] = [];
    await pi.handlers.get('session_compact')?.[0]?.(
      {
        type: 'session_compact',
        compactionEntry: { summary: '## Overview\nx', tokensBefore: 1000, firstKeptEntryId: 'e1' },
        fromExtension: true,
        reason: 'manual',
        willRetry: false,
      },
      { ...sessionCtx, ui: { notify: (m: string) => notifications.push(m) } },
    );

    const dir = sessionDirFor(WORKSPACE, join(tempDir, 'compact'));
    const log = await readFile(join(dir, 'compaction-log.jsonl'), 'utf8');
    const record = JSON.parse(log.trim()) as {
      reason: string;
      summaryChars: number;
      historyFile: string;
    };
    expect(record.reason).toBe('manual');
    expect(record.summaryChars).toBe('## Overview\nx'.length);
    expect(record.historyFile).toContain(dir);
    expect(notifications[0]).toContain('transcript archived');
  });

  it('injects the carry-over block exactly once per compaction', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    pi.handlers.get('session_start')?.[0]?.({ type: 'session_start' }, sessionCtx);
    await pi.handlers.get('session_before_compact')?.[0]?.(
      {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'e1',
          messagesToSummarize: [{ role: 'user', content: 'hello' }],
          tokensBefore: 1000,
          fileOps: {
            read: new Set<string>(),
            written: new Set<string>(),
            edited: new Set(['src/a.ts']),
          },
        },
        reason: 'manual',
        willRetry: false,
      },
      sessionCtx,
    );

    const first = pi.handlers.get('context')?.[0]?.(
      {
        type: 'context',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'next' }] }],
      },
      sessionCtx,
    ) as { messages: Array<{ role: string; content: Array<{ text: string }> }> };
    expect(first.messages[0]?.role).toBe('user');
    expect(first.messages[0]?.content[0]?.text).toContain('<compaction_carryover');
    expect(first.messages[0]?.content[0]?.text).toContain('src/a.ts');
    expect(first.messages[1]?.content[0]?.text).toBe('next');

    const second = pi.handlers.get('context')?.[0]?.({ type: 'context', messages: [] }, sessionCtx);
    expect(second).toBeUndefined();
  });

  it('tracks edited files from tool_execution_end (edit/write only)', async () => {
    const pi = createFakePi();
    compactExtension(pi);
    pi.handlers.get('session_start')?.[0]?.({ type: 'session_start' }, sessionCtx);
    const handler = pi.handlers.get('tool_execution_end')?.[0];
    handler?.({ toolName: 'edit', input: { path: 'src/a.ts' } }, sessionCtx);
    handler?.({ toolName: 'write', input: { path: 'src/b.ts' } }, sessionCtx);
    handler?.({ toolName: 'edit', input: { path: 'src/a.ts' } }, sessionCtx);
    handler?.({ toolName: 'read', input: { path: 'src/c.ts' } }, sessionCtx);
    handler?.({ toolName: 'bash', input: { command: 'ls' } }, sessionCtx);

    await pi.handlers.get('session_before_compact')?.[0]?.(
      {
        type: 'session_before_compact',
        preparation: {
          firstKeptEntryId: 'e1',
          messagesToSummarize: [{ role: 'user', content: 'x' }],
          tokensBefore: 10,
        },
        reason: 'manual',
        willRetry: false,
      },
      sessionCtx,
    );

    const notifications: string[] = [];
    await pi.handlers.get('session_compact')?.[0]?.(
      {
        type: 'session_compact',
        compactionEntry: { summary: 'done', tokensBefore: 10, firstKeptEntryId: 'e1' },
        fromExtension: true,
        reason: 'manual',
        willRetry: false,
      },
      { ...sessionCtx, ui: { notify: (m: string) => notifications.push(m) } },
    );

    const dir = sessionDirFor(WORKSPACE, join(tempDir, 'compact'));
    const files = await readdir(dir);
    const historyName = files.find((f) => f.endsWith('.md'))!;
    const history = await readFile(join(dir, historyName), 'utf8');
    expect(history).not.toContain('src/c.ts');
    const log = await readFile(join(dir, 'compaction-log.jsonl'), 'utf8');
    const record = JSON.parse(log.trim()) as { editedFiles: number };
    expect(record.editedFiles).toBe(2);
    const injected = pi.handlers.get('context')?.[0]?.(
      {
        type: 'context',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'next' }] }],
      },
      sessionCtx,
    ) as { messages: Array<{ content: Array<{ text: string }> }> };
    expect(injected.messages[0]?.content[0]?.text).toContain('src/a.ts');
    expect(injected.messages[0]?.content[0]?.text).toContain('src/b.ts');
  });

  it('dedupes and caps the edited-file list', () => {
    const state = createCompactState(WORKSPACE, tempDir);
    recordEditedFiles(state, ['a.ts', 'a.ts', 'b.ts']);
    expect(state.editedFiles).toEqual(['a.ts', 'b.ts']);
    const many = Array.from({ length: EDITED_FILES_LIMIT + 10 }, (_, i) => `f${i}.ts`);
    recordEditedFiles(state, many);
    expect(state.editedFiles.length).toBe(EDITED_FILES_LIMIT);
    expect(state.editedFiles.at(-1)).toBe(`f${EDITED_FILES_LIMIT + 9}.ts`);
  });

  it('extracts edited paths only for edit/write tool ends', () => {
    expect(extractEditedPathFromToolEnd({ toolName: 'edit', input: { path: 'a.ts' } })).toBe(
      'a.ts',
    );
    expect(extractEditedPathFromToolEnd({ toolName: 'write', input: { path: 'b.ts' } })).toBe(
      'b.ts',
    );
    expect(
      extractEditedPathFromToolEnd({ toolName: 'read', input: { path: 'c.ts' } }),
    ).toBeUndefined();
    expect(extractEditedPathFromToolEnd({ toolName: 'edit', args: { file_path: 'd.ts' } })).toBe(
      'd.ts',
    );
  });

  it('merges preparation fileOps edited+written into carry-over', () => {
    const state = createCompactState(WORKSPACE, tempDir);
    mergePreparationFileOps(state, {
      fileOps: { read: new Set(['r.ts']), written: new Set(['w.ts']), edited: new Set(['e.ts']) },
    });
    expect(state.editedFiles).toEqual(['e.ts', 'w.ts']);
  });

  it('shouldInjectCarryover fires once per history file', () => {
    const state = createCompactState(WORKSPACE, tempDir);
    expect(shouldInjectCarryover(state)).toBe(false);
    state.lastHistoryFile = '/tmp/history-1.md';
    expect(shouldInjectCarryover(state)).toBe(true);
    expect(shouldInjectCarryover(state, '/tmp/history-1.md')).toBe(false);
    state.lastHistoryFile = '/tmp/history-2.md';
    expect(shouldInjectCarryover(state, '/tmp/history-1.md')).toBe(true);
  });

  it('renders the carry-over block with the archive pointer and edited files', () => {
    const state = createCompactState(WORKSPACE, tempDir);
    state.lastHistoryFile = '/tmp/history-1.md';
    state.editedFiles = ['a.ts', 'b.ts'];
    const block = renderCarryoverBlock(state);
    expect(block).toContain('/tmp/history-1.md');
    expect(block).toContain('- a.ts');
    expect(block).toContain('</compaction_carryover>');
  });

  it('renders a Devin <summary> with citations, edited files, and current state', () => {
    const summary = renderDevinSummary({
      messages: [
        { role: 'user', content: 'Ship the compact extension' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Writing the history file next.' },
            { type: 'tool_use', id: 't1', name: 'edit', input: { path: 'compact.ts' } },
          ],
        },
      ],
      historyFile: '/tmp/history-1.md',
      editedFiles: ['compact.ts'],
      tokensBefore: 90000,
      focus: 'keep the registerCommand signature',
      isSplitTurn: true,
    });
    expect(summary).toContain('<summary>');
    expect(summary).toContain('## Overview');
    expect(summary).toContain('Ship the compact extension');
    expect(summary).toContain('/tmp/history-1.md');
    expect(summary).toContain('compact.ts');
    expect(summary).toContain('[m2]');
    expect(summary).toContain('keep the registerCommand signature');
    expect(summary).toContain('split a turn');
    expect(summary).toContain('</summary>');
  });

  it('renders transcript markdown with citations, tool calls, and truncation notes', () => {
    const markdown = renderTranscriptMarkdown(
      [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'working' },
            {
              type: 'tool_use',
              id: 't1',
              name: 'edit',
              input: { path: 'a.ts', new_string: 'x'.repeat(5000) },
            },
          ],
        },
      ],
      {
        cwd: WORKSPACE,
        createdAt: new Date('2026-09-20T10:00:00.000Z'),
        tokensBefore: 42,
        isSplitTurn: true,
      },
    );
    expect(markdown).toContain('### [m1] user');
    expect(markdown).toContain('### [m2] assistant');
    expect(markdown).toContain('#### [m2.edit] edit (t1)');
    expect(markdown).toContain('truncated');
    expect(markdown).toContain('- split turn: yes');
    expect(markdown).toContain('- compacted at: 2026-09-20T10:00:00.000Z');
  });
});
