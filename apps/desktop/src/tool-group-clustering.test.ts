import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  clusterToolCalls,
  resolveToolClusterKind,
  computeBatchSummary,
  countExploredFiles,
  isExploratoryKind,
  summarizeToolBusyMs,
} from './tool-group-clustering';

function makeTool(
  toolName: string,
  overrides?: Partial<ToolCardUi>,
): ToolCardUi {
  return {
    toolCallId: `call-${Math.random().toString(36).slice(2)}`,
    toolName,
    status: 'done',
    output: '',
    ...overrides,
  };
}

describe('resolveToolClusterKind', () => {
  it('identifies search tools', () => {
    expect(resolveToolClusterKind(makeTool('grep_search'))).toBe('search');
    expect(resolveToolClusterKind(makeTool('find_by_name'))).toBe('search');
    expect(resolveToolClusterKind(makeTool('code_search'))).toBe('search');
  });

  it('identifies read tools', () => {
    expect(resolveToolClusterKind(makeTool('view_file'))).toBe('read');
    expect(resolveToolClusterKind(makeTool('read_file'))).toBe('read');
    expect(resolveToolClusterKind(makeTool('list_dir'))).toBe('read');
  });

  it('identifies command tools', () => {
    expect(resolveToolClusterKind(makeTool('run_command'))).toBe('command');
    expect(resolveToolClusterKind(makeTool('bash'))).toBe('command');
    expect(resolveToolClusterKind(makeTool('exec'))).toBe('command');
  });

  it('identifies edit tools', () => {
    expect(resolveToolClusterKind(makeTool('replace_file_content'))).toBe('edit');
    expect(resolveToolClusterKind(makeTool('write_to_file'))).toBe('edit');
  });

  it('identifies subagent tools', () => {
    expect(resolveToolClusterKind(makeTool('piwin_subagent_run'))).toBe('subagent');
  });

  it('identifies exploratory kinds', () => {
    expect(isExploratoryKind('explore')).toBe(true);
    expect(isExploratoryKind('read')).toBe(true);
    expect(isExploratoryKind('search')).toBe(true);
    expect(isExploratoryKind('web')).toBe(true);
    expect(isExploratoryKind('edit')).toBe(false);
    expect(isExploratoryKind('command')).toBe(false);
    expect(isExploratoryKind('subagent')).toBe(false);
  });
});

describe('clusterToolCalls', () => {
  it('returns empty array when input is empty', () => {
    expect(clusterToolCalls([])).toEqual([]);
  });

  it('leaves an isolated single search call as a single item', () => {
    const tools = [makeTool('grep_search')];
    const clustered = clusterToolCalls(tools);
    expect(clustered).toHaveLength(1);
    expect(clustered[0]?.kind).toBe('single');
  });

  it('groups consecutive exploratory calls (search + read) into a unified explore batch', () => {
    const tools = [
      makeTool('grep_search', { presentation: { kind: 'filesystem', title: 'grep 1', durationMs: 100 } }),
      makeTool('grep_search', { presentation: { kind: 'filesystem', title: 'grep 2', durationMs: 150 } }),
      makeTool('view_file', { presentation: { kind: 'filesystem', title: 'read 3', targetPaths: ['/src/main.ts'], durationMs: 200 } }),
    ];
    const clustered = clusterToolCalls(tools);
    expect(clustered).toHaveLength(1);
    expect(clustered[0]?.kind).toBe('batch');
    if (clustered[0]?.kind === 'batch') {
      expect(clustered[0].clusterKind).toBe('explore');
      expect(clustered[0].tools).toHaveLength(3);
      expect(clustered[0].summary.totalCount).toBe(3);
      expect(clustered[0].summary.searchCount).toBe(2);
      expect(clustered[0].summary.fileCount).toBe(1);
      expect(clustered[0].summary.totalDurationMs).toBe(450);
      expect(clustered[0].summary.hasError).toBe(false);
    }
  });

  it('groups distinct clusters separated by edit / command tool types', () => {
    const tools = [
      makeTool('grep_search'),
      makeTool('grep_search'),
      makeTool('view_file'),
      makeTool('replace_file_content'), // Standalone edit
      makeTool('run_command'),
      makeTool('run_command'),
    ];
    const clustered = clusterToolCalls(tools);
    expect(clustered).toHaveLength(4);

    // First batch: 3 exploratory tools (grep + grep + view)
    expect(clustered[0]?.kind).toBe('batch');
    if (clustered[0]?.kind === 'batch') {
      expect(clustered[0].clusterKind).toBe('explore');
      expect(clustered[0].tools).toHaveLength(3);
    }

    // Second: single edit item (never clustered into exploration)
    expect(clustered[1]?.kind).toBe('single');
    if (clustered[1]?.kind === 'single') {
      expect(clustered[1].tool.toolName).toBe('replace_file_content');
    }

    // Commands stay as individual rows, not a command capsule
    expect(clustered[2]?.kind).toBe('single');
    if (clustered[2]?.kind === 'single') {
      expect(clustered[2].tool.toolName).toBe('run_command');
    }
    expect(clustered[3]?.kind).toBe('single');
    if (clustered[3]?.kind === 'single') {
      expect(clustered[3].tool.toolName).toBe('run_command');
    }
  });

  it('keeps consecutive commands as individual singles', () => {
    const clustered = clusterToolCalls([makeTool('bash'), makeTool('bash'), makeTool('run_command')]);
    expect(clustered).toHaveLength(3);
    expect(clustered.every((item) => item.kind === 'single')).toBe(true);
  });

  it('detects running and error states in batch summary', () => {
    const tools = [
      makeTool('run_command', { status: 'done', presentation: { kind: 'shell', title: 'done cmd', durationMs: 300 } }),
      makeTool('run_command', { status: 'error', presentation: { kind: 'shell', title: 'err cmd', durationMs: 200 } }),
      makeTool('run_command', { status: 'running', presentation: { kind: 'shell', title: 'running cmd' } }),
    ];
    const summary = computeBatchSummary('command', tools);
    expect(summary.totalCount).toBe(3);
    expect(summary.hasRunning).toBe(true);
    expect(summary.activeTool?.status).toBe('running');
    expect(summary.hasError).toBe(true);
    expect(summary.errorCount).toBe(1);
    expect(summary.totalDurationMs).toBe(500);
  });

  it('does not count cancelled tools as batch errors', () => {
    const tools = [
      makeTool('read', {
        status: 'error',
        presentation: {
          kind: 'filesystem',
          title: 'read',
          error: { category: 'cancelled', message: 'This operation was aborted' },
        },
      }),
    ];
    const summary = computeBatchSummary('read', tools);
    expect(summary.hasError).toBe(false);
    expect(summary.errorCount).toBe(0);
  });
});

describe('call-chain classification regressions', () => {
  function batchShape(tools: ToolCardUi[]): string[] {
    return clusterToolCalls(tools).map((item) =>
      item.kind === 'batch' ? `batch:${item.clusterKind}` : `single:${item.tool.toolName}`,
    );
  }

  it('matches whole name tokens, not substrings', () => {
    expect(resolveToolClusterKind(makeTool('send_notification'))).toBe('other');
    expect(resolveToolClusterKind(makeTool('code_review'))).toBe('other');
    expect(resolveToolClusterKind(makeTool('preview_start'))).toBe('other');
    expect(resolveToolClusterKind(makeTool('dispatch_job'))).toBe('other');
    expect(resolveToolClusterKind(makeTool('readFile'))).toBe('read');
    expect(resolveToolClusterKind(makeTool('str_replace_editor'))).toBe('edit');
  });

  it('never folds browser automation or MCP calls into an explore capsule', () => {
    const mcp = (name: string): ToolCardUi =>
      makeTool(name, {
        presentation: { kind: 'mcp', title: name, actionVerb: 'MCP (playwright)' },
      });
    expect(batchShape([mcp('playwright.browser_click'), mcp('playwright.browser_type')])).toEqual([
      'single:playwright.browser_click',
      'single:playwright.browser_type',
    ]);
    expect(batchShape([makeTool('browser_click'), makeTool('browser_navigate')])).toEqual([
      'single:browser_click',
      'single:browser_navigate',
    ]);
    expect(
      resolveToolClusterKind(
        makeTool('git_fetch', { presentation: { kind: 'git', title: 'git', actionVerb: 'Git pull' } }),
      ),
    ).toBe('other');
  });

  it('counts only read files, not search directories or glob patterns', () => {
    const tools = [
      makeTool('grep', {
        presentation: { kind: 'filesystem', title: 'grep', actionVerb: 'Searched', targetPaths: ['src'] },
      }),
      makeTool('find', {
        presentation: { kind: 'filesystem', title: 'find', actionVerb: 'Searched', targetPaths: ['**/*.ts'] },
      }),
      makeTool('read', {
        presentation: { kind: 'filesystem', title: 'read', actionVerb: 'Read', targetPaths: ['src/a.ts'] },
      }),
      makeTool('read', {
        status: 'error',
        presentation: { kind: 'filesystem', title: 'read', actionVerb: 'Read', targetPaths: ['src/missing.ts'] },
      }),
    ];
    expect(countExploredFiles(tools)).toBe(1);
    expect(computeBatchSummary('explore', tools).fileCount).toBe(1);
  });

  it('reports overlapping parallel calls as busy time, not a sum', () => {
    const timed = (start: string, end: string): ToolCardUi =>
      makeTool('read', {
        presentation: {
          kind: 'filesystem',
          title: 'read',
          actionVerb: 'Read',
          startedAt: start,
          endedAt: end,
          durationMs: 2000,
        },
      });
    const parallel = [
      timed('2026-09-15T00:00:00.000Z', '2026-09-15T00:00:02.000Z'),
      timed('2026-09-15T00:00:00.100Z', '2026-09-15T00:00:02.000Z'),
      timed('2026-09-15T00:00:01.000Z', '2026-09-15T00:00:02.500Z'),
      timed('2026-09-15T00:00:10.000Z', '2026-09-15T00:00:11.000Z'),
    ];
    expect(summarizeToolBusyMs(parallel)).toBe(3500);
    expect(summarizeToolBusyMs([makeTool('read')])).toBeUndefined();
  });
});

/**
 * The reported case: a Pi agent loop exploring with `bash grep` rendered as
 * `思考过程 → bash → 思考过程 → bash` down the transcript, because every shell
 * call classified as a side-effecting command and broke the explore flow.
 */
function shellTool(command: string): ToolCardUi {
  return makeTool('bash', {
    presentation: {
      kind: 'shell',
      title: 'Ran command',
      actionVerb: 'Ran command',
      command,
    },
  });
}

function readTool(path: string): ToolCardUi {
  return makeTool('read_file', {
    presentation: {
      kind: 'filesystem',
      title: 'Read',
      actionVerb: 'Read',
      targetPaths: [path],
    },
  });
}

describe('resolveToolClusterKind — shell intent', () => {
  it('reads a read-only shell sweep as exploration, not a command', () => {
    expect(resolveToolClusterKind(shellTool('grep -n "add-btn" src/'))).toBe('search');
    expect(resolveToolClusterKind(shellTool('rg -n "handleStartNewSession"'))).toBe('search');
    expect(resolveToolClusterKind(shellTool('cat package.json'))).toBe('read');
    expect(resolveToolClusterKind(shellTool('ls -la apps/desktop/src'))).toBe('read');
    expect(resolveToolClusterKind(shellTool('git status --short'))).toBe('read');
  });

  it('keeps every side effect out of the read-only capsule', () => {
    expect(resolveToolClusterKind(shellTool('rm -rf dist'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('cat a.ts > b.ts'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('git commit -m wip'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('pnpm install'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('curl https://example.com'))).toBe('command');
  });

  it('will not fold a command it cannot name', () => {
    expect(resolveToolClusterKind(shellTool('./scripts/seed-fixtures.sh'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('make deploy'))).toBe('command');
  });

  it('treats verification as a command, not exploration', () => {
    expect(resolveToolClusterKind(shellTool('pnpm vitest run'))).toBe('command');
    expect(resolveToolClusterKind(shellTool('pnpm typecheck'))).toBe('command');
  });

  it('falls back to command when the host reported no command text', () => {
    const bare = makeTool('bash', {
      presentation: { kind: 'shell', title: 'Ran command', actionVerb: 'Ran command' },
    });
    expect(resolveToolClusterKind(bare)).toBe('command');
  });

  it('clusters an interleaved read / bash-grep sweep into one explore batch', () => {
    const clustered = clusterToolCalls([
      shellTool('grep -n "add-btn" src/'),
      readTool('src/use-session-actions.ts'),
      shellTool('rg -n "handleStartNewSession" --type ts'),
      readTool('src/workspace-resolver.ts'),
    ]);
    expect(clustered).toHaveLength(1);
    expect(clustered[0]?.kind).toBe('batch');
    if (clustered[0]?.kind !== 'batch') return;
    expect(clustered[0].tools).toHaveLength(4);
  });

  it('breaks the batch at a command it cannot vouch for', () => {
    const clustered = clusterToolCalls([
      shellTool('grep -n foo src/'),
      shellTool('cat src/a.ts'),
      shellTool('./scripts/seed-fixtures.sh'),
      shellTool('grep -n bar src/'),
      shellTool('cat src/b.ts'),
    ]);
    expect(clustered.map((item) => item.kind)).toEqual(['batch', 'single', 'batch']);
  });
});

describe('countExploredFiles — shell reads', () => {
  it('does not let a pathless shell read inflate the file count', () => {
    expect(countExploredFiles([shellTool('ls -la src'), shellTool('cat src/a.ts')])).toBe(0);
  });

  it('still counts files that a read tool names', () => {
    expect(countExploredFiles([shellTool('ls -la src'), readTool('src/a.ts')])).toBe(1);
  });
});
