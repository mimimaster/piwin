import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  clusterToolCalls,
  resolveToolClusterKind,
  computeBatchSummary,
  isExploratoryKind,
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
    expect(clustered).toHaveLength(3);

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

    // Third batch: 2 command tools
    expect(clustered[2]?.kind).toBe('batch');
    if (clustered[2]?.kind === 'batch') {
      expect(clustered[2].clusterKind).toBe('command');
      expect(clustered[2].tools).toHaveLength(2);
    }
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
});
