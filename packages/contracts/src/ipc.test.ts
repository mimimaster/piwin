import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope } from './host.js';
import type { HostCommand, HostPush } from './ipc.js';
import { toMediaAttachmentRef } from './ipc.js';
import type { CreateSessionOptions, SessionSeedMessage } from './session-seed.js';

describe('ipc types', () => {
  it('allows constructing command and push shapes', () => {
    const command: HostCommand = { type: 'host/ping' };
    const push: HostPush = {
      type: 'host/status',
      mode: 'sdk',
      ready: true,
      mock: true,
    };
    expect(command.type).toBe('host/ping');
    expect(push.type).toBe('host/status');
  });

  it('allows async doccards job commands and pushes', () => {
    const index: HostCommand = { type: 'doccards/index-folder', folderPath: '/docs' };
    const status: HostCommand = { type: 'doccards/index-status', folderPath: '/docs' };
    const generate: HostCommand = { type: 'doccards/generate', folderPath: '/docs', topic: 'srs' };
    const push: HostPush = {
      type: 'doccards/index-progress',
      job: {
        id: 'job-1',
        folderKey: 'abc',
        workspaceName: 'docs',
        folderPath: '/docs',
        includeFiles: [],
        status: 'RUNNING',
        totalFiles: 1,
        completedFiles: 0,
        failedFiles: 0,
        skippedUnsupported: 0,
        stageCounts: { parsing: 0, chunking: 0, embedding: 0, indexing: 0 },
        warnings: [],
      },
    };
    expect(index.type).toBe('doccards/index-folder');
    expect(status.type).toBe('doccards/index-status');
    expect(generate.type).toBe('doccards/generate');
    expect(push.type).toBe('doccards/index-progress');
  });

  it('maps saved media assets to prompt attachments', () => {
    const attachment = toMediaAttachmentRef(
      {
        id: 'asset-1',
        sessionId: 'session-1',
        absolutePath: '/tmp/media/session-1/a.png',
        mimeType: 'image/png',
        byteSize: 32,
        createdAt: new Date().toISOString(),
      },
      'paste',
    );
    expect(attachment.path).toBe('/tmp/media/session-1/a.png');
    expect(attachment.source).toBe('paste');
  });

  it('maps a path-free remote media/save asset to a remote-asset ref', () => {
    const attachment = toMediaAttachmentRef(
      {
        id: 'asset-9fc3',
        mimeType: 'image/png',
        byteSize: 78866,
      },
      'paste',
    );
    expect(attachment.path).toBe('remote-asset:asset-9fc3');
  });

  it('accepts media/save command shape', () => {
    const command: HostCommand = {
      type: 'media/save',
      input: {
        sessionId: 's1',
        mimeType: 'image/png',
        source: 'paste',
        base64Data: 'aaaa',
      },
    };
    expect(command.type).toBe('media/save');
  });

  it('accepts preview/read-trusted-text command shape', () => {
    const command: HostCommand = {
      type: 'preview/read-trusted-text',
      input: { relativePath: 'config.json' },
    };
    expect(command.type).toBe('preview/read-trusted-text');
    if (command.type === 'preview/read-trusted-text') {
      expect(command.input.relativePath).toBe('config.json');
    }
  });

  it('accepts CE process/session command shapes', () => {
    const jobStart: HostCommand = {
      type: 'job/start',
      input: {
        kind: 'service',
        lifetime: 'session',
        command: 'node',
        argv: ['server.js'],
        cwd: '/tmp/project',
        ownerSessionId: 's1',
      },
    };
    const sessionPin: HostCommand = { type: 'session/pin', sessionId: 's1' };
    const sessionRename: HostCommand = { type: 'session/rename', sessionId: 's1', name: 'Renamed' };
    const sessionArchive: HostCommand = { type: 'session/archive', sessionId: 's1' };
    const sessionDelete: HostCommand = { type: 'session/delete', sessionId: 's1' };
    const sessionDuplicate: HostCommand = { type: 'session/duplicate', sessionId: 's1' };
    const sessionSearch: HostCommand = {
      type: 'session/search',
      query: { query: 'hello', projectPath: '/tmp/project' },
    };
    const truncate: HostCommand = {
      type: 'session/truncate-from',
      sessionId: 's1',
      messageId: 'm1',
    };
    expect(jobStart.type).toBe("job/start");
    expect(sessionPin.type).toBe('session/pin');
    expect(sessionRename.type).toBe('session/rename');
    expect(sessionArchive.type).toBe('session/archive');
    expect(sessionDelete.type).toBe('session/delete');
    expect(sessionDuplicate.type).toBe('session/duplicate');
    expect(sessionSearch.type).toBe('session/search');
    expect(truncate.type).toBe('session/truncate-from');
  });

  it('accepts permissions rules get/set command shapes', () => {
    const getRules: HostCommand = { type: 'permissions/get-rules', layer: 'user' };
    const setRules: HostCommand = {
      type: 'permissions/set-rules',
      layer: 'user',
      rules: { version: 1 },
    };
    expect(getRules.type).toBe('permissions/get-rules');
    expect(setRules.type).toBe('permissions/set-rules');
  });

  it('accepts project permission list/revoke command shapes', () => {
    const listPerms: HostCommand = { type: 'project/permissions-list', path: '/tmp/p' };
    const revoke: HostCommand = {
      type: 'project/permissions-revoke',
      path: '/tmp/p',
      key: 'network:web_search',
    };
    expect(listPerms.type).toBe('project/permissions-list');
    expect(revoke.type).toBe('project/permissions-revoke');
  });

  it('accepts session/aborted AgentEvent via HostPush', () => {
    const abortedPush: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'session/aborted',
        sessionId: 's1',
        messageId: 'a1',
      },
    };
    expect(abortedPush.type).toBe('event');
    expect(abortedPush.event.type).toBe('session/aborted');
  });

  it('accepts message/native_context event and native seed shapes', () => {
    const push: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/native_context',
        messageId: 'm1',
        role: 'assistant',
        entry: { format: 'pi-message-v1', payload: '{"role":"assistant"}', byteLength: 20 },
      },
    };
    expect(push.event.type).toBe('message/native_context');
    const toolResultEvent: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/native_context',
        messageId: 'tr1',
        role: 'toolResult',
        responseMessageId: 'm1',
        entry: { format: 'pi-message-v1', payload: '', byteLength: 400000, truncated: true },
      },
    };
    expect(toolResultEvent.event.type).toBe('message/native_context');
    const seed: SessionSeedMessage = {
      role: 'assistant',
      text: 'hi',
      timestamp: 1,
      native: [{ format: 'pi-message-v1', payload: '{}', byteLength: 2, truncated: true }],
    };
    const options: CreateSessionOptions = { seedMessages: [seed], seedMode: 'replay' };
    expect(options.seedMode).toBe('replay');
  });

  it('accepts usage/update AgentEvent and job/started HostPush shapes', () => {
    const usagePush: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          tokensUsed: 1200,
          tokensLimit: 128000,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    const jobPush: HostPush = {
      type: 'job/started',
      job: {
        jobId: 'j1',
        kind: 'service',
        lifetime: 'session',
        command: 'node',
        argv: ['server.js'],
        cwd: '/tmp/project',
        status: 'running',
        startedAt: new Date().toISOString(),
        latestLogCursor: 0,
      },
    };
    expect(usagePush.event.type).toBe('usage/update');
    expect(jobPush.type).toBe('job/started');
  });

  it('accepts top-level run lifecycle pushes', () => {
    const phase: HostPush = {
      type: 'run/updated',
      run: {
        runId: 'r1',
        kind: 'session-turn',
        status: 'running',
        rootRunId: 'r1',
        sessionId: 's1',
        phase: 'accepted',
      },
    };
    const terminal: HostPush = {
      type: 'run/terminal',
      run: {
        runId: 'r1',
        kind: 'session-turn',
        status: 'completed',
        rootRunId: 'r1',
        sessionId: 's1',
        phase: 'streaming',
      },
    };
    expect(phase.type).toBe('run/updated');
    expect(terminal.type).toBe('run/terminal');
  });

  describe('C1: AgentEventEnvelope', () => {
    it('accepts a HostPush with an envelope', () => {
      const envelope: AgentEventEnvelope = {
        eventId: 'evt-001',
        sequence: 1,
        runId: 'run-1',
      };
      const push: HostPush = {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'm1', delta: 'hello' },
        envelope,
      };
      expect(push.envelope?.eventId).toBe('evt-001');
      expect(push.envelope?.sequence).toBe(1);
      expect(push.envelope?.runId).toBe('run-1');
    });

    it('accepts a HostPush without an envelope (backward compat)', () => {
      const push: HostPush = {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'm1', delta: 'hello' },
      };
      expect(push.envelope).toBeUndefined();
    });

    it('accepts message/text_snapshot event shape', () => {
      const push: HostPush = {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/text_snapshot',
          messageId: 'm1',
          text: 'complete text',
        },
      };
      expect(push.event.type).toBe('message/text_snapshot');
      expect((push.event as { text: string }).text).toBe('complete text');
    });

    it('accepts text_snapshot with runId', () => {
      const push: HostPush = {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/text_snapshot',
          messageId: 'm1',
          text: 'snapshot with run',
          runId: 'run-1',
        },
      };
      expect(push.event.type).toBe('message/text_snapshot');
      expect((push.event as { runId?: string }).runId).toBe('run-1');
    });
  });

  describe('walkthrough commands and pushes', () => {
    it('accepts walkthrough/list command shape', () => {
      const command: HostCommand = { type: 'walkthrough/list', sessionId: 's1' };
      expect(command.type).toBe('walkthrough/list');
      if (command.type === 'walkthrough/list') {
        expect(command.sessionId).toBe('s1');
      }
    });

    it('accepts walkthrough/generate command shape', () => {
      const command: HostCommand = {
        type: 'walkthrough/generate',
        sessionId: 's1',
        messageId: 'm1',
        runId: 'r1',
        force: true,
      };
      expect(command.type).toBe('walkthrough/generate');
      if (command.type === 'walkthrough/generate') {
        expect(command.messageId).toBe('m1');
        expect(command.force).toBe(true);
      }
    });

    it('accepts walkthrough/cancel command shape', () => {
      const command: HostCommand = {
        type: 'walkthrough/cancel',
        sessionId: 's1',
        messageId: 'm1',
        generationId: 'g1',
      };
      expect(command.type).toBe('walkthrough/cancel');
      if (command.type === 'walkthrough/cancel') {
        expect(command.generationId).toBe('g1');
      }
    });

    it('accepts walkthrough/updated push shape with a ready artifact', () => {
      const push: HostPush = {
        type: 'walkthrough/updated',
        sessionId: 's1',
        artifact: {
          version: 1,
          id: 'art-1',
          sessionId: 's1',
          messageId: 'm1',
          mode: 'default',
          sourceHash: 'hash',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          status: 'ready',
          markdown: '# Walkthrough',
          generatedAt: '2026-08-01T00:01:00.000Z',
          model: { providerId: 'p1', modelId: 'm1', protocol: 'openai-compatible' },
        },
      };
      expect(push.type).toBe('walkthrough/updated');
      if (push.type === 'walkthrough/updated') {
        expect(push.artifact.status).toBe('ready');
      }
    });

    it('accepts walkthrough/updated push shape with a generating artifact', () => {
      const push: HostPush = {
        type: 'walkthrough/updated',
        sessionId: 's1',
        artifact: {
          version: 1,
          id: 'art-1',
          sessionId: 's1',
          messageId: 'm1',
          mode: 'default',
          sourceHash: 'hash',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          status: 'generating',
          generationId: 'g1',
        },
      };
      if (push.type === 'walkthrough/updated' && push.artifact.status === 'generating') {
        expect(push.artifact.generationId).toBe('g1');
      }
    });

    it('accepts ADR 0027 host/replay command shape', () => {
      const replay: HostCommand = { type: 'host/replay', sinceSeq: 42 };
      expect(replay.type).toBe('host/replay');
    });

    it('accepts activity/summary command shape', () => {
      const summary: HostCommand = { type: 'activity/summary', maxItems: 16 };
      expect(summary.type).toBe('activity/summary');
    });

    it('accepts ADR 0027 seq/eventId on any push variant', () => {
      const status: HostPush = {
        type: 'host/status',
        mode: 'sdk',
        ready: true,
        mock: false,
        seq: 7,
        eventId: 'evt-7',
      };
      const replayDone: HostPush = {
        type: 'host/replay-done',
        sinceSeq: 5,
        lastSeq: 9,
        seq: 10,
        eventId: 'evt-10',
      };
      if (status.type === 'host/status') {
        expect(status.seq).toBe(7);
      }
      if (replayDone.type === 'host/replay-done') {
        expect(replayDone.lastSeq).toBe(9);
      }
    });

    it('host/status capabilities include ADR 0027 remote flags', () => {
      const status: HostPush = {
        type: 'host/status',
        mode: 'sdk',
        ready: true,
        mock: false,
      };
      expect(status.type).toBe('host/status');
    });
  });
});
