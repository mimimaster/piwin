import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHost,
  HostResponse,
  SessionHandle,
  SessionTranscriptMessage,
  SessionTranscriptDocument,
} from '@piwin/contracts';
import { COMPLETED_STOP_OUTCOME } from '@piwin/contracts';
import {
  archiveSessionRecord,
  createSessionRecord,
  deleteSessionRecord,
  getSessionRecord,
  upsertSessionRecord,
} from '@piwin/session';
import { handleSideChatCommand, type SideChatCommandContext } from './side-chat-commands.js';
import {
  handleSessionProductCommand,
  type SessionProductCommandContext,
} from './session-product-commands.js';
import { getPiwinSessionIndexPath, getPiwinSessionTranscriptPath } from '../paths.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function successData(response: HostResponse): unknown {
  if (response.success) return response.data;
  throw new Error(`expected success but got error: ${response.error}`);
}

function makeUserMessage(id: string, text: string): SessionTranscriptMessage {
  return { id, role: 'user', text, createdAt: '2026-08-01T00:00:00.000Z', status: 'done' };
}

function makeAssistantMessage(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text,
    createdAt: '2026-08-01T00:00:01.000Z',
    status: 'done',
    runId: 'run-1',
    endedAt: '2026-08-01T00:00:02.000Z',
    outcome: 'completed',
  };
}

function makeTranscript(
  sessionId: string,
  messages: SessionTranscriptMessage[],
): SessionTranscriptDocument {
  return {
    version: 1,
    sessionId,
    projectPath: '/proj',
    messages,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

async function writeTranscript(
  rootDir: string,
  sessionId: string,
  doc: SessionTranscriptDocument,
): Promise<void> {
  const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
  await mkdir(join(rootDir, 'sessions', sessionId), { recursive: true });
  await writeFile(transcriptPath, JSON.stringify(doc), 'utf8');
}

function createMockSessionHandle(sessionId: string): SessionHandle {
  return {
    id: sessionId,
    async prompt() {
      return COMPLETED_STOP_OUTCOME;
    },
    async steer(): Promise<void> {},
    async followUp(): Promise<void> {},
    async abort(): Promise<void> {},
    async getMessages(): Promise<[]> {
      return [];
    },
    async getTree(): Promise<{ root: null; activeLeafId: null }> {
      return { root: null, activeLeafId: null };
    },
    subscribe(): () => void {
      return () => {};
    },
  };
}

function createMockHost(sessionId: string): AgentHost {
  return {
    mode: 'sdk',
    createSession: async () => createMockSessionHandle(randomUUID()),
    resumeSession: async () => createMockSessionHandle(randomUUID()),
    listSessions: async () => [],
    dropSession: async () => undefined,
    dispose: async () => undefined,
  };
}

async function createRootWithMainSession(
  mainSessionId: string,
  messages: SessionTranscriptMessage[],
): Promise<{ rootDir: string; indexPath: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-side-chat-test-'));
  const indexPath = getPiwinSessionIndexPath(rootDir);

  const record = createSessionRecord({
    id: mainSessionId,
    projectPath: '/proj',
    scope: { kind: 'project', projectPath: '/proj' },
    name: 'Main Session',
  });
  await upsertSessionRecord(indexPath, record);
  await writeTranscript(rootDir, mainSessionId, makeTranscript(mainSessionId, messages));

  return { rootDir, indexPath };
}

function createSideChatContext(
  rootDir: string,
  transcriptMap: Map<string, SessionTranscriptMessage[]>,
): SideChatCommandContext {
  const host = createMockHost(randomUUID());
  return {
    piwinRoot: rootDir,
    createSession: (input) => host.createSession(input),
    disposeLiveSession: vi.fn(async () => undefined),
    bindSession: vi.fn(async () => undefined),
    pushStatus: vi.fn(),
    loadTranscriptMessages: async (sessionId: string) => transcriptMap.get(sessionId) ?? [],
  };
}

function createProductContext(
  rootDir: string,
  transcriptMap: Map<string, SessionTranscriptMessage[]>,
): SessionProductCommandContext {
  const host = createMockHost(randomUUID());
  const indexPath = getPiwinSessionIndexPath(rootDir);
  return {
    piwinRoot: rootDir,
    createSession: (input) => host.createSession(input),
    loadTranscriptMessages: async (sessionId: string) => transcriptMap.get(sessionId) ?? [],
    getTranscriptStore: async () => {
      throw new Error('transcript store is not configured for this product-context unit test');
    },
    withTranscriptStore: async () => {
      throw new Error('transcript store is not configured for this product-context unit test');
    },
    abortLiveSession: vi.fn(async () => undefined),
    disposeLiveSession: vi.fn(async () => undefined),
    archiveSession: vi.fn((sessionId) => archiveSessionRecord(indexPath, sessionId)),
    tryArchiveLifecycleCandidate: vi.fn(async () => ({ status: 'busy' as const })),
    deleteSession: vi.fn(async (sessionId) => {
      const removed = await deleteSessionRecord(indexPath, sessionId);
      return removed ? { removed } : undefined;
    }),
    bindSession: vi.fn(async () => undefined),
    pushStatus: vi.fn(),
  };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('side-chat commands', () => {
  it('side-chat/open creates a side-chat session with kind side-chat and no parentSessionId', async () => {
    const mainId = 'main-001';
    const messages = [makeUserMessage('m1', 'Hello'), makeAssistantMessage('m2', 'Hi there')];
    const { rootDir, indexPath } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const response = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      context,
    );

    expect(response).not.toBeNull();
    const data = successData(response!) as {
      sideChatSessionId: string;
      session: { kind: string };
      relation: { kind: string; sourceSessionId: string; contextVersion: number };
    };
    expect(data.session.kind).toBe('side-chat');
    expect(data.relation.kind).toBe('side-chat');
    expect(data.relation.sourceSessionId).toBe(mainId);
    expect(data.relation.contextVersion).toBe(1);

    const sideRecord = await getSessionRecord(indexPath, data.sideChatSessionId);
    expect(sideRecord?.kind).toBe('side-chat');
    expect(sideRecord?.parentSessionId).toBeUndefined();
    expect(sideRecord?.sideChatRelation?.sourceSessionId).toBe(mainId);
  });

  it('side-chat/open rejects when source is a side-chat session', async () => {
    const mainId = 'main-002';
    const messages = [makeUserMessage('m1', 'Hello')];
    const { rootDir } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      context,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;

    const nestedResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: sideId },
      undefined,
      context,
    );

    expect(nestedResponse).not.toBeNull();
    expect(nestedResponse!.success).toBe(false);
    expect(nestedResponse!.success ? '' : nestedResponse!.error).toContain('main product session');
  });

  it('side-chat/open rejects when source session does not exist', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-side-chat-test-'));
    const context = createSideChatContext(rootDir, new Map());

    const response = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: 'nonexistent' },
      undefined,
      context,
    );

    expect(response).not.toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.success ? '' : response!.error).toContain('Unknown source session');
  });

  it('side-chat/list returns side chats for a source session, newest first', async () => {
    const mainId = 'main-003';
    const messages = [makeUserMessage('m1', 'Hello')];
    const { rootDir } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const r1 = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId, name: 'First' },
      undefined,
      context,
    );
    const r2 = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId, name: 'Second' },
      undefined,
      context,
    );
    const id1 = (successData(r1!) as { sideChatSessionId: string }).sideChatSessionId;
    const id2 = (successData(r2!) as { sideChatSessionId: string }).sideChatSessionId;

    const listResponse = await handleSideChatCommand(
      { type: 'side-chat/list', sourceSessionId: mainId },
      undefined,
      context,
    );
    const data = successData(listResponse!) as { sessions: { id: string }[] };
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions[0]!.id).toBe(id2);
    expect(data.sessions[1]!.id).toBe(id1);
  });

  it('side-chat/sync increments context version when new messages exist', async () => {
    const mainId = 'main-004';
    const initialMessages = [makeUserMessage('m1', 'Hello'), makeAssistantMessage('m2', 'Hi')];
    const { rootDir, indexPath } = await createRootWithMainSession(mainId, initialMessages);
    const transcriptMap = new Map([[mainId, initialMessages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      context,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;
    const initialVersion = (successData(openResponse!) as { relation: { contextVersion: number } })
      .relation.contextVersion;
    expect(initialVersion).toBe(1);

    const updatedMessages = [
      ...initialMessages,
      makeUserMessage('m3', 'New question'),
      makeAssistantMessage('m4', 'New answer'),
    ];
    transcriptMap.set(mainId, updatedMessages);

    const syncResponse = await handleSideChatCommand(
      { type: 'side-chat/sync', sideChatSessionId: sideId },
      undefined,
      context,
    );
    const syncData = successData(syncResponse!) as {
      relation: { contextVersion: number };
      context: { version: number };
    };
    expect(syncData.relation.contextVersion).toBe(2);
    expect(syncData.context.version).toBe(2);

    const updated = await getSessionRecord(indexPath, sideId);
    expect(updated?.sideChatRelation?.contextVersion).toBe(2);
    expect(updated?.sideChatContext?.version).toBe(2);
  });

  it('side-chat/sync returns unchanged when no new messages', async () => {
    const mainId = 'main-005';
    const messages = [makeUserMessage('m1', 'Hello'), makeAssistantMessage('m2', 'Hi')];
    const { rootDir } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      context,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;

    const syncResponse = await handleSideChatCommand(
      { type: 'side-chat/sync', sideChatSessionId: sideId },
      undefined,
      context,
    );
    const syncData = successData(syncResponse!) as { relation: { contextVersion: number } };
    expect(syncData.relation.contextVersion).toBe(1);
  });

  it('side-chat/sync rejects unknown side chat session', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-side-chat-test-'));
    const context = createSideChatContext(rootDir, new Map());

    const response = await handleSideChatCommand(
      { type: 'side-chat/sync', sideChatSessionId: 'nonexistent' },
      undefined,
      context,
    );
    expect(response).not.toBeNull();
    expect(response!.success).toBe(false);
    expect(response!.success ? '' : response!.error).toContain('Unknown side chat');
  });

  it('archiving main session marks side chat source state as archived', async () => {
    const mainId = 'main-006';
    const messages = [makeUserMessage('m1', 'Hello')];
    const { rootDir, indexPath } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const sideChatCtx = createSideChatContext(rootDir, transcriptMap);
    const productCtx = createProductContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      sideChatCtx,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;

    await handleSessionProductCommand(
      { type: 'session/archive', sessionId: mainId },
      undefined,
      productCtx,
    );

    const sideRecord = await getSessionRecord(indexPath, sideId);
    expect(sideRecord?.sideChatRelation?.sourceState).toBe('archived');
  });

  it('deleting main session marks side chat source state as missing', async () => {
    const mainId = 'main-007';
    const messages = [makeUserMessage('m1', 'Hello')];
    const { rootDir, indexPath } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const sideChatCtx = createSideChatContext(rootDir, transcriptMap);
    const productCtx = createProductContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      sideChatCtx,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;

    await handleSessionProductCommand(
      { type: 'session/archive', sessionId: mainId },
      undefined,
      productCtx,
    );
    await handleSessionProductCommand(
      { type: 'session/delete', sessionId: mainId },
      undefined,
      productCtx,
    );

    const sideRecord = await getSessionRecord(indexPath, sideId);
    expect(sideRecord?.sideChatRelation?.sourceState).toBe('missing');
  });

  it('side-chat/sync rejects when source state is not active', async () => {
    const mainId = 'main-008';
    const messages = [makeUserMessage('m1', 'Hello')];
    const { rootDir } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const sideChatCtx = createSideChatContext(rootDir, transcriptMap);
    const productCtx = createProductContext(rootDir, transcriptMap);

    const openResponse = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId },
      undefined,
      sideChatCtx,
    );
    const sideId = (successData(openResponse!) as { sideChatSessionId: string }).sideChatSessionId;

    await handleSessionProductCommand(
      { type: 'session/archive', sessionId: mainId },
      undefined,
      productCtx,
    );

    const syncResponse = await handleSideChatCommand(
      { type: 'side-chat/sync', sideChatSessionId: sideId },
      undefined,
      sideChatCtx,
    );
    expect(syncResponse).not.toBeNull();
    expect(syncResponse!.success).toBe(false);
    expect(syncResponse!.success ? '' : syncResponse!.error).toContain('not active');
  });

  it('side-chat/open with sourceMessageId uses that message as through boundary', async () => {
    const mainId = 'main-009';
    const messages = [
      makeUserMessage('m1', 'First question'),
      makeAssistantMessage('m2', 'First answer'),
      makeUserMessage('m3', 'Second question'),
      makeAssistantMessage('m4', 'Second answer'),
    ];
    const { rootDir } = await createRootWithMainSession(mainId, messages);
    const transcriptMap = new Map([[mainId, messages]]);
    const context = createSideChatContext(rootDir, transcriptMap);

    const response = await handleSideChatCommand(
      { type: 'side-chat/open', sourceSessionId: mainId, sourceMessageId: 'm2' },
      undefined,
      context,
    );
    const data = successData(response!) as { context: { throughMessageId?: string } };
    expect(data.context.throughMessageId).toBe('m2');
  });
});

/* ------------------------------------------------------------------ */
/* Blueprint / tool policy tests                                       */
/* ------------------------------------------------------------------ */

describe('side-chat tool policy (buildSideChatToolPolicy)', () => {
  it('compiles read-only profile with no write/execute/mcp/planning tools', async () => {
    const { compileBlueprintForWorker } = await import('../blueprint-compiler.js');
    const compiled = await compileBlueprintForWorker(
      {
        projectPath: '/proj',
        sessionKind: 'side-chat',
        sessionName: 'Test Side Chat',
      },
      {
        config: {
          hostMode: 'sdk',
          agentMock: false,
          providers: [],
          media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
          artifact: {
            enabled: true,
            triggerMode: 'automatic',
            decisionPrompt: { mode: 'default', customPrompt: '' },
            maxBytes: 1024,
          },
        },
        discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
        trustResolver: async () => true,
      },
    );
    const tools = compiled.sessionBlueprint.capabilitySnapshot.tools;
    expect(tools.enabledFamilies).toContain('filesystem-read');
    expect(tools.enabledFamilies).not.toContain('filesystem-write');
    expect(tools.enabledFamilies).not.toContain('shell');
    expect(tools.enabledFamilies).not.toContain('process');
    expect(tools.enabledFamilies).not.toContain('browser');
    expect(tools.enabledFamilies).not.toContain('planning');
    expect(tools.enabledFamilies).not.toContain('delegate');
    expect(tools.enabledMcpServerIds).toEqual([]);
    expect(tools.piBuiltinToolNames).toContain('read');
    expect(tools.piBuiltinToolNames).toContain('grep');
    expect(tools.piBuiltinToolNames).toContain('find');
    expect(tools.piBuiltinToolNames).toContain('ls');
    expect(tools.piBuiltinToolNames).not.toContain('write');
    expect(tools.piBuiltinToolNames).not.toContain('execute');
  });
});
