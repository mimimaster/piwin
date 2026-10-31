import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionScope } from '@piwin/contracts';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatMessageUi,
} from '../conversation/chat-reducer.js';
import type { PresentationStorage } from '../conversation/presentation-storage.js';
import {
  MAX_TRANSCRIPT_CACHE_BYTES,
  MAX_TRANSCRIPT_CACHE_MESSAGES,
  measureTranscriptCacheBytes,
} from '../conversation/transcript-page-cache.js';
import type { HostClient } from '../host/host-client.js';
import { sessionCacheHostKey } from './session-cache-host.js';
import { buildSessionListSnapshot, writeSessionListSnapshot } from './session-list-snapshot.js';
import {
  buildSessionStartupSnapshot,
  createSessionStartupState,
  readSessionStartupSnapshot,
  writeSessionStartupSnapshot,
} from './session-startup-cache.js';

function memoryStorage(): PresentationStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function client(transport: 'live' | 'mock' | 'remote' = 'live', hostId = 'host-a') {
  return {
    getTransport: () => transport,
    getRemoteTarget: () => ({ hostId, endpoint: 'ws://test' }),
  } as unknown as HostClient;
}

function message(id: string, text = 'Saved reply'): ChatMessageUi {
  return { id, text, role: 'assistant', thinking: '', tools: [], attachments: [], status: 'done' };
}

function loadedState(scope: SessionScope = { kind: 'general' }) {
  return {
    ...createInitialChatUiState(),
    activeSessionId: 'saved',
    transcriptOwnerSessionId: 'saved',
    hostReady: true,
    activeScope: scope,
    messages: [message('reply')],
    sessionEntitiesById: { saved: { id: 'saved', name: 'Saved conversation', scope } },
  };
}

describe('session startup cache', () => {
  let storage: PresentationStorage;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('paints a months-old sidebar and last conversation before contacting the Host', () => {
    writeSessionListSnapshot(
      storage,
      'local',
      buildSessionListSnapshot({
        general: [{ id: 'saved', name: 'Saved conversation' }],
        projectSessionsByPath: {},
        recentProjects: [],
      }),
    );
    const snapshot = buildSessionStartupSnapshot(loadedState());
    expect(snapshot).not.toBeNull();
    if (snapshot === null) throw new Error('Missing fixture snapshot');
    writeSessionStartupSnapshot('local', { ...snapshot, savedAt: '2026-01-01T00:00:00Z' }, storage);
    const restored = createSessionStartupState(client(), storage);
    expect(restored.generalSessions.map((row) => row.id)).toEqual(['saved']);
    expect(restored.activeSessionId).toBe('saved');
    expect(restored.messages.map((row) => row.text)).toEqual(['Saved reply']);
    expect(restored.awaitingTranscript).toBe(true);
    expect(restored.hostReady).toBe(false);
    expect(restored.foregroundAdmission).toBe('unknown');
    expect(restored.warmSessionCache.order).toEqual([]);
  });

  it('never restores project trust, live runs, permission prompts or media URLs', () => {
    const state = loadedState({ kind: 'project', projectPath: 'prj_1' });
    state.projectTrusted = true;
    state.streaming = true;
    state.activeRunId = 'old-run';
    state.messages = [
      {
        ...message('reply'),
        status: 'streaming',
        runId: 'old-run',
        tools: [
          { toolCallId: 'running', toolName: 'bash', status: 'running', output: 'in flight' },
          { toolCallId: 'done', toolName: 'read', status: 'done', output: 'saved output' },
        ],
        replyWriterPending: true,
      },
    ];
    writeSessionStartupSnapshot('local', buildSessionStartupSnapshot(state), storage);
    const restored = createSessionStartupState(client(), storage);
    expect(restored.projectPath).toBe('prj_1');
    expect(restored.projectTrusted).toBe(false);
    expect(restored.trustDialogOpen).toBe(false);
    expect(restored.streaming).toBe(false);
    expect(restored.activeRunId).toBeNull();
    expect(restored.permissionPrompt).toBeNull();
    expect(restored.contextUsage).toBeNull();
    expect(restored.messages[0]).toMatchObject({
      status: 'done',
      attachments: [],
      tools: [{ toolCallId: 'done', status: 'done' }],
    });
    expect(restored.messages[0]).not.toHaveProperty('runId');
    expect(restored.messages[0]).not.toHaveProperty('replyWriterPending');
  });

  it('isolates local, remote and mock data while following a paired Host across roaming', () => {
    writeSessionStartupSnapshot('host-a', buildSessionStartupSnapshot(loadedState()), storage);
    expect(createSessionStartupState(client('remote', 'host-a'), storage).activeSessionId).toBe(
      'saved',
    );
    expect(
      createSessionStartupState(client('remote', 'host-b'), storage).activeSessionId,
    ).toBeNull();
    expect(createSessionStartupState(client('live'), storage).activeSessionId).toBeNull();
    expect(createSessionStartupState(client('mock'), storage).activeSessionId).toBeNull();
    expect(sessionCacheHostKey(client('remote', 'host-a'))).toBe('host-a');
    expect(sessionCacheHostKey(client('mock'))).toBeNull();
  });

  it('lets the authoritative transcript replace the cached preview', () => {
    writeSessionStartupSnapshot('local', buildSessionStartupSnapshot(loadedState()), storage);
    const restored = createSessionStartupState(client(), storage);
    const fresh = chatUiReducer(restored, {
      type: 'session/load-messages',
      sessionId: 'saved',
      messages: [
        {
          id: 'new',
          role: 'assistant',
          text: 'Fresh from Host',
          status: 'done',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ],
    });
    expect(fresh.awaitingTranscript).toBe(false);
    expect(fresh.messages.map((row) => row.text)).toEqual(['Fresh from Host']);
  });

  it('bounds both message count and UTF-8 bytes and skips an unpainted target', () => {
    const state = loadedState();
    state.messages = Array.from({ length: MAX_TRANSCRIPT_CACHE_MESSAGES + 20 }, (_, index) =>
      message(`m-${index}`, '好'.repeat(30_000)),
    );
    const snapshot = buildSessionStartupSnapshot(state);
    expect(snapshot?.messages.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_CACHE_MESSAGES);
    expect(measureTranscriptCacheBytes(snapshot?.messages ?? [])).toBeLessThanOrEqual(
      MAX_TRANSCRIPT_CACHE_BYTES,
    );
    expect(snapshot?.messages.at(-1)?.id).toBe(`m-${MAX_TRANSCRIPT_CACHE_MESSAGES + 19}`);
    expect(buildSessionStartupSnapshot({ ...state, awaitingTranscript: true })).toBeNull();
    expect(buildSessionStartupSnapshot({ ...state, transcriptOwnerSessionId: 'other' })).toBeNull();
  });

  it('treats corrupt or unavailable storage as an empty optional cache', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad: PresentationStorage = { ...storage, getItem: () => '{bad json' };
    expect(createSessionStartupState(client(), bad).activeSessionId).toBeNull();
    const blocked: PresentationStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    try {
      expect(createSessionStartupState(client(), blocked).activeSessionId).toBeNull();
      expect(() => writeSessionStartupSnapshot('local', null, blocked)).not.toThrow();
    } finally {
      warn.mockRestore();
    }
  });

  it('drops invalid messages instead of trusting nested cached fields', () => {
    const snapshot = buildSessionStartupSnapshot(loadedState());
    const malformed = {
      ...snapshot,
      messages: [
        null,
        { id: 'bad', role: 'assistant', text: 4 },
        {
          ...message('safe'),
          model: { providerId: 42, modelId: 'bad' },
          tools: [null, { toolCallId: 'broken' }],
        },
      ],
    };
    const overridden: PresentationStorage = {
      ...storage,
      getItem: () => JSON.stringify(malformed),
    };
    const read = readSessionStartupSnapshot('local', overridden);
    expect(read?.messages.map((row) => row.id)).toEqual(['safe']);
    expect(read?.messages[0]?.tools).toEqual([]);
    expect(read?.messages[0]).not.toHaveProperty('model');
  });
});
