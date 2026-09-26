import { describe, expect, it } from 'vitest';
import {
  formatToolDuration,
  projectToolRow,
  readQuestionPrompt,
  shortenPath,
  toolRowIcon,
} from './tool-row-view.js';

describe('toolRowIcon', () => {
  it('buckets by Host kind first, then splits filesystem by read / write / search', () => {
    expect(toolRowIcon('shell', 'bash', false)).toBe('term');
    expect(toolRowIcon('filesystem', 'read', false)).toBe('file');
    expect(toolRowIcon('filesystem', 'edit', false)).toBe('edit');
    expect(toolRowIcon('filesystem', 'anything', true)).toBe('edit');
    expect(toolRowIcon('filesystem', 'grep', false)).toBe('search');
    expect(toolRowIcon('web', 'web_fetch', false)).toBe('globe');
    expect(toolRowIcon('mcp', 'github__list_issues', false)).toBe('puzzle');
  });

  it('rescues untyped tools by name and falls back to a neutral glyph', () => {
    expect(toolRowIcon(undefined, 'bash', false)).toBe('term');
    expect(toolRowIcon('other', 'code_search', false)).toBe('search');
    expect(toolRowIcon('other', 'questionnaire', false)).toBe('chat');
    expect(toolRowIcon('other', 'flashcard_create', false)).toBe('bolt');
  });
});

describe('projectToolRow', () => {
  it('uses the Host command as the argument chip', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'bash',
      status: 'done',
      presentation: { kind: 'shell', title: 'bash', command: 'ls -la\necho done', exitCode: 0, durationMs: 6200 },
    });
    expect(row).toMatchObject({ verb: 'bash', arg: 'ls -la', status: 'done', meta: ['6.2s'] });
    expect(row.failure).toBeUndefined();
  });

  it('marks a non-zero exit as a failure even when the tool call succeeded', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'bash',
      status: 'done',
      presentation: { kind: 'shell', title: 'bash', command: 'pnpm test', exitCode: 1 },
    });
    expect(row.status).toBe('fail');
    expect(row.failure).toBe('退出码 1');
  });

  it('shows the question for questionnaire tools instead of the JSON dump', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'questionnaire',
      status: 'done',
      presentation: {
        kind: 'other',
        title: 'questionnaire',
        inputPreview: '{"questions":[{"id":"drink","prompt":"你最喜欢的饮料是什么？","options":["咖啡","茶","可乐","酒（红酒…',
      },
    });
    expect(row.arg).toBe('你最喜欢的饮料是什么？');
    expect(row.question).toBe('你最喜欢的饮料是什么？');
  });

  it('never renders an argument dump summary as the chip', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'mystery',
      status: 'done',
      presentation: { kind: 'other', title: 'mystery', summary: '{"a":1}' },
    });
    expect(row.arg).toBeUndefined();
  });

  it('reports writes and path counts', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'write_file',
      status: 'running',
      presentation: {
        kind: 'filesystem',
        title: 'write_file',
        targetPaths: ['a.ts', 'b.ts'],
        changedPaths: ['a.ts'],
        durationMs: 40,
      },
    });
    expect(row).toMatchObject({ arg: 'a.ts +1', status: 'run', isWrite: true, meta: [] });
  });
});

describe('subagent rows', () => {
  it('reads the delegated task from a bounded preview and uses a readable verb', () => {
    const row = projectToolRow({
      id: 't1',
      name: 'piwin_subagent_start',
      status: 'done',
      presentation: {
        kind: 'subagent',
        title: 'Subagent',
        summary: 'sleep-A',
        inputPreview: '{"task":"Run exactly one shell command: `sleep 8`\\n\\nRules:\\n- Do…',
      },
    });
    expect(row.verb).toBe('委派子代理');
    expect(row.arg).toBe('sleep-A');
    expect(row.subagent?.task).toContain('Run exactly one shell command');
  });

  it('lists wait runs with Host execution status and child links', () => {
    const row = projectToolRow({
      id: 't2',
      name: 'piwin_subagent_wait',
      status: 'running',
      presentation: {
        kind: 'other',
        title: 'piwin_subagent_wait',
        subagentControl: {
          phase: 'waiting',
          total: 1,
          completed: 0,
          failed: 0,
          cancelled: 0,
          needsIntegration: 0,
          runs: [{ runId: 'run-1', title: 'explorer', executionStatus: 'running', childSessionId: 'child-1' }],
        },
      },
    });
    expect(row.verb).toBe('等待子代理');
    expect(row.subagent?.runs).toEqual([
      {
        runId: 'run-1',
        title: 'explorer',
        status: 'running',
        statusLabel: '运行中',
        activity: undefined,
        childSessionId: 'child-1',
      },
    ]);
  });
});

describe('formatting helpers', () => {
  it('formats durations for the meta column', () => {
    expect(formatToolDuration(40)).toBe('40ms');
    expect(formatToolDuration(4100)).toBe('4.1s');
    expect(formatToolDuration(42_000)).toBe('42s');
    expect(formatToolDuration(63_000)).toBe('1m 3s');
  });

  it('keeps the basename visible when shortening paths', () => {
    expect(shortenPath('packages/session/src/deeply/nested/folder/session-index.ts')).toBe(
      '…/folder/session-index.ts',
    );
    expect(shortenPath('a.ts')).toBe('a.ts');
  });

  it('reads escaped prompts', () => {
    expect(readQuestionPrompt('{"prompt":"say \\"hi\\""}')).toBe('say "hi"');
    expect(readQuestionPrompt(undefined)).toBeUndefined();
  });
});
