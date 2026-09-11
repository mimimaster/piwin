import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, ToolResult } from '@piwin/contracts';
import { createFolderRag, type FolderRag } from '@piwin/doc-rag';
import { createNoteStore, getNotesRoot } from '@piwin/notes';
import { buildNotesTools } from './notes-tools.js';
import { evaluateNotesPermission } from './permission-policy.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { createHostToolAdmission } from './tools/tool-admission.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';

let cleanupDirs: string[] = [];
let openRags: FolderRag[] = [];

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

async function executeThroughAdmission(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: 'allow' | 'ask' | 'deny';
    signal?: AbortSignal;
  }) => Promise<'allow' | 'ask' | 'deny'>,
): Promise<ToolResult> {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode: () => 'auto',
    ...(requestPermission ? { requestPermission } : {}),
    projectRoot: '/tmp',
  });
  const router = new HostToolExecutionRouter({ tools: [tool], admission });
  return router.execute(tool.descriptor.name, args, new AbortController().signal, {
    sessionId: 'session-1',
    runtimeGenerationId: 'generation-1',
    runId: 'run-1',
    toolName: tool.descriptor.name,
  });
}

function outputOf(result: ToolResult): string {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result.output;
}

afterEach(async () => {
  for (const rag of openRags) rag.close();
  openRags = [];
  for (const dir of cleanupDirs) await rm(dir, { recursive: true, force: true });
  cleanupDirs = [];
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-notes-tools-'));
  cleanupDirs.push(root);
  const store = createNoteStore({ piwinRoot: root });
  const rag = createFolderRag({ piwinRoot: root });
  openRags.push(rag);
  return { store, rag, piwinRoot: root };
}

describe('buildNotesTools', () => {
  it('returns empty when disabled', async () => {
    const { store, rag } = await setup();
    expect(buildNotesTools({ store, rag, enabled: false })).toEqual([]);
  });

  it('registers note_* tools; write asks and reindexes', async () => {
    const { store, rag, piwinRoot } = await setup();
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildNotesTools({ store, rag, piwinRoot, enabled: true });
    expect(tools.map((tool) => tool.descriptor.name).sort()).toEqual([
      'note_delete',
      'note_list',
      'note_read',
      'note_update',
      'note_write',
    ]);

    const writeTool = tools.find((tool) => tool.descriptor.name === 'note_write');
    if (!writeTool) throw new Error('note_write missing');
    const writtenRaw = outputOf(
      await executeThroughAdmission(
        writeTool,
        {
          title: '闪卡设计',
          content: '闪卡复习使用 FSRS 调度算法。',
          tags: ['srs'],
        },
        requestPermission,
      ),
    );
    const written = JSON.parse(writtenRaw) as { id: string };
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'notes:note_write' }),
    );
    const listed = await rag.listDocuments(getNotesRoot(piwinRoot));
    expect(listed.some((row) => row.relativePath.endsWith(`${written.id}.md`))).toBe(true);

    const listTool = tools.find((tool) => tool.descriptor.name === 'note_list');
    if (!listTool) throw new Error('note_list missing');
    requestPermission.mockClear();
    const listRaw = outputOf(await executeTool(listTool, {}));
    const records = JSON.parse(listRaw) as Array<{ id: string }>;
    expect(records.some((record) => record.id === written.id)).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('rejects Notes writes sourced from health-sensitive tool results', async () => {
    const { store, rag } = await setup();
    const tools = buildNotesTools({ store, rag, enabled: true });
    const writeTool = tools.find((tool) => tool.descriptor.name === 'note_write');
    if (!writeTool) throw new Error('note_write missing');
    const result = await executeTool(writeTool, {
      title: '睡眠',
      content: 'sleep-duration 420',
      sourceDetails: { sensitivity: 'health' },
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'permission-denied',
      message: 'Health-sensitive tool results cannot be stored in Notes.',
    });

    const fromOutput = await executeTool(writeTool, {
      title: '睡眠',
      content:
        'These values are user-authorized Apple Health summaries. Missing metrics are unknown, not zero.\nsleep-duration 420',
    });
    expect(fromOutput).toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('denies mutating tools without a permission gate (non-interactive)', async () => {
    const { store, rag } = await setup();
    const tools = buildNotesTools({ store, rag, enabled: true });
    const deleteTool = tools.find((tool) => tool.descriptor.name === 'note_delete');
    if (!deleteTool) throw new Error('note_delete missing');
    const result = await executeThroughAdmission(deleteTool, { noteId: 'whatever' });
    expect(result).toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('includeReadTools false keeps only write tools', async () => {
    const { store, rag } = await setup();
    const tools = buildNotesTools({ store, rag, enabled: true, includeReadTools: false });
    expect(tools.map((tool) => tool.descriptor.name).sort()).toEqual([
      'note_delete',
      'note_update',
      'note_write',
    ]);
  });

  it('readOnly mode returns only note_list, note_read', async () => {
    const { store, rag } = await setup();
    const tools = buildNotesTools({ store, rag, enabled: true, readOnly: true });
    expect(tools.map((t) => t.descriptor.name).sort()).toEqual([
      'note_list',
      'note_read',
    ]);
  });
});

describe('evaluateNotesPermission', () => {
  it('allows reads, asks for mutations, denies empty ids', () => {
    expect(evaluateNotesPermission('note_search', 'query').decision).toBe('allow');
    expect(evaluateNotesPermission('note_list', '').decision).toBe('allow');
    expect(evaluateNotesPermission('note_write', 'content').decision).toBe('ask');
    expect(evaluateNotesPermission('note_delete', 'id-1').decision).toBe('ask');
    expect(evaluateNotesPermission('note_delete', '').decision).toBe('deny');
    expect(evaluateNotesPermission('note_search', 'x'.repeat(501)).decision).toBe('deny');
  });
});
