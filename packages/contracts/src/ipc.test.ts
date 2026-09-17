import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope } from './host.js';
import { normalizeDecodedAgentEvent } from './agent-event-decode.js';
import type { HostCommand, HostPush } from './ipc.js';
import { toMediaAttachmentRef } from './ipc.js';
import type { SavedMediaAsset } from './media.js';
import type { CreateSessionOptions, SessionSeedMessage } from './session-seed.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

describe('ipc types', () => {
  it('keeps ipc modules under the source-file size cap', () => {
    const files = [
      'ipc.ts',
      'ipc-host-commands.ts',
      'ipc-session-commands.ts',
      'ipc-commands-turn-changes.ts',
      'ipc-host-push.ts',
    ];
    for (const fileName of files) {
      const lines = readFileSync(join(SRC_DIR, fileName), 'utf8').split('\n').length;
      expect(lines, fileName).toBeLessThanOrEqual(1000);
    }
    expect(readFileSync(join(SRC_DIR, 'ipc.ts'), 'utf8').split('\n').length).toBeLessThan(200);
  });

  it('re-exports the public IPC surface from the ipc.ts aggregate', () => {
    const source = readFileSync(join(SRC_DIR, 'ipc.ts'), 'utf8');
    expect(source).toContain("from './ipc-host-commands.js'");
    expect(source).toContain("from './ipc-host-push.js'");
    expect(source).toContain("from './ipc-commands-turn-changes.js'");
    expect(source).toContain('HostTurnChangeCommand');
  });

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
    const savedAsset: SavedMediaAsset = {
      id: 'asset-1',
      sessionId: 'session-1',
      absolutePath: '/tmp/media/session-1/a.png',
      mimeType: 'image/png',
      byteSize: 32,
      createdAt: new Date().toISOString(),
    };
    const attachment = toMediaAttachmentRef(savedAsset, 'paste');
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

  it('accepts chunked media/save command shapes', () => {
    const begin: HostCommand = {
      type: 'media/save-begin',
      input: {
        sessionId: 's1',
        mimeType: 'image/png',
        source: 'paste',
        byteSize: 2048,
      },
    };
    const chunk: HostCommand = {
      type: 'media/save-chunk',
      input: { uploadId: 'u1', chunkIndex: 0, base64Data: 'aaaa' },
    };
    const finish: HostCommand = {
      type: 'media/save-finish',
      input: { uploadId: 'u1' },
    };
    expect(begin.type).toBe('media/save-begin');
    expect(chunk.type).toBe('media/save-chunk');
    expect(finish.type).toBe('media/save-finish');
  });

  it('accepts media/delete command shape', () => {
    const command: HostCommand = {
      type: 'media/delete',
      input: { sessionId: 's1', assetId: 'asset-1' },
    };
    expect(command.type).toBe('media/delete');
  });

  it('accepts media/read thumb variant', () => {
    const command: HostCommand = {
      type: 'media/read',
      input: { sessionId: 's1', assetId: 'asset-1', variant: 'thumb' },
    };
    expect(command.type).toBe('media/read');
    if (command.type === 'media/read') {
      expect(command.input.variant).toBe('thumb');
    }
  });

  it('accepts media/read thumbEdge', () => {
    const command: HostCommand = {
      type: 'media/read',
      input: { sessionId: 's1', assetId: 'asset-1', variant: 'thumb', thumbEdge: 256 },
    };
    expect(command.type).toBe('media/read');
    if (command.type === 'media/read') {
      expect(command.input.thumbEdge).toBe(256);
    }
  });

  it('accepts media/read byte ranges for assets over the wire cap', () => {
    const command: HostCommand = {
      type: 'media/read',
      input: { sessionId: 's1', assetId: 'asset-1', offset: 0, length: 384 * 1024 },
    };
    expect(command.type).toBe('media/read');
    if (command.type === 'media/read') {
      expect(command.input.offset).toBe(0);
      expect(command.input.length).toBe(384 * 1024);
    }
  });

  it('accepts media/list command shape', () => {
    const command: HostCommand = {
      type: 'media/list',
      input: { kind: 'image', query: 'portrait', limit: 40 },
    };
    expect(command.type).toBe('media/list');
    if (command.type === 'media/list') {
      expect(command.input.kind).toBe('image');
    }
  });

  it('accepts media/list without kind for the mixed library', () => {
    const command: HostCommand = {
      type: 'media/list',
      input: { query: 'portrait', limit: 40 },
    };
    expect(command.type).toBe('media/list');
    if (command.type === 'media/list') {
      expect(command.input.kind).toBeUndefined();
    }
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

  it('accepts preview/read-local-file command shape', () => {
    const command: HostCommand = {
      type: 'preview/read-local-file',
      input: { sessionId: 's1', absolutePath: '/tmp/ncg-boot2.png' },
    };
    expect(command.type).toBe('preview/read-local-file');
    if (command.type === 'preview/read-local-file') {
      expect(command.input.absolutePath).toBe('/tmp/ncg-boot2.png');
    }
  });

  it('accepts preview/export-local-file command shape', () => {
    const command: HostCommand = {
      type: 'preview/export-local-file',
      input: { absolutePath: '/tmp/out.zip', maxBytes: 1024 },
    };
    expect(command.type).toBe('preview/export-local-file');
    if (command.type === 'preview/export-local-file') {
      expect(command.input.absolutePath).toBe('/tmp/out.zip');
      expect(command.input.maxBytes).toBe(1024);
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
    expect(jobStart.type).toBe('job/start');
    expect(sessionPin.type).toBe('session/pin');
    expect(sessionRename.type).toBe('session/rename');
    expect(sessionArchive.type).toBe('session/archive');
    expect(sessionDelete.type).toBe('session/delete');
    expect(sessionDuplicate.type).toBe('session/duplicate');
    expect(sessionSearch.type).toBe('session/search');
    expect(truncate.type).toBe('session/truncate-from');
  });

  it('accepts session/set-composer-profile command shapes', () => {
    const modelOnly: HostCommand = {
      type: 'session/set-composer-profile',
      sessionId: 's1',
      model: { providerId: 'openai', modelId: 'gpt-5' },
    };
    const thinkingOnly: HostCommand = {
      type: 'session/set-composer-profile',
      sessionId: 's1',
      thinkingLevel: 'high',
    };
    const both: HostCommand = {
      type: 'session/set-composer-profile',
      sessionId: 's1',
      model: { providerId: 'openai', modelId: 'gpt-5' },
      thinkingLevel: 'high',
    };
    const extracted: Extract<HostCommand, { type: 'session/set-composer-profile' }> = both;
    expect(modelOnly.type).toBe('session/set-composer-profile');
    expect(thinkingOnly.type).toBe('session/set-composer-profile');
    expect(both.type).toBe('session/set-composer-profile');
    expect(extracted.sessionId).toBe('s1');
  });

  it('accepts session/index-updated with op updated', () => {
    const push: Extract<HostPush, { type: 'session/index-updated' }> = {
      type: 'session/index-updated',
      op: 'updated',
      sessionId: 's1',
      session: {
        id: 's1',
        scope: { kind: 'project', projectPath: '/tmp' },
        workingDirectory: '/tmp',
        projectPath: '/tmp',
        updatedAt: '2026-08-30T00:00:00.000Z',
        messageCount: 0,
        model: { providerId: 'openai', modelId: 'gpt-5' },
      },
    };
    expect(push.type).toBe('session/index-updated');
    expect(push.op).toBe('updated');
    expect(push.session?.model?.modelId).toBe('gpt-5');
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

  it('normalizes legacy error events without failure to unknown-agent-failure', () => {
    const push: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: { type: 'error', message: 'Stream ended without finish_reason' },
    };
    const decoded = normalizeDecodedAgentEvent(push.event);
    expect(decoded).toMatchObject({
      type: 'error',
      failure: {
        code: 'unknown-agent-failure',
        origin: 'runtime',
        retriable: false,
      },
    });
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

  describe('ADR 0055 conversation tree', () => {
    it('accepts session/branch-list and session/branch-switch command shapes', () => {
      const list: HostCommand = { type: 'session/branch-list', sessionId: 's1' };
      const switchCommand: HostCommand = {
        type: 'session/branch-switch',
        sessionId: 's1',
        targetMessageId: 'm-head',
        confirm: true,
        messageProjection: 'tail',
      };
      expect(list.type).toBe('session/branch-list');
      expect(switchCommand.targetMessageId).toBe('m-head');
    });

    it('accepts the session/branch-updated push shape', () => {
      const push: HostPush = {
        type: 'session/branch-updated',
        sessionId: 's1',
        activeLeafMessageId: 'm-leaf',
        branchPointCount: 2,
      };
      expect(push.branchPointCount).toBe(2);
      const emptied: HostPush = {
        type: 'session/branch-updated',
        sessionId: 's1',
        activeLeafMessageId: null,
        branchPointCount: 0,
      };
      expect(emptied.activeLeafMessageId).toBeNull();
    });

    it('accepts PromptInput.branchFromMessageId', () => {
      const prompt: HostCommand = {
        type: 'session/prompt',
        sessionId: 's1',
        input: {
          text: 'rewritten question',
          branchFromMessageId: 'm-user-2',
          clientMessageId: 'client-1',
        },
      };
      expect(prompt.type).toBe('session/prompt');
    });

    it('accepts PromptInput.retryUserMessageId without a second user row', () => {
      const prompt: HostCommand = {
        type: 'session/prompt',
        sessionId: 's1',
        input: {
          text: '',
          retryUserMessageId: 'm-user-2',
          keepPreviousAttempt: true,
        },
        confirm: true,
      };
      expect(prompt.input.retryUserMessageId).toBe('m-user-2');
      expect(prompt.input.keepPreviousAttempt).toBe(true);
      expect(prompt.confirm).toBe(true);
    });

    it('accepts PromptInput.permissionPreset from the composer Run Mode pill', () => {
      const prompt: HostCommand = {
        type: 'session/prompt',
        sessionId: 's1',
        input: {
          text: 'edit the file',
          permissionPreset: 'ask',
        },
      };
      expect(prompt.input.permissionPreset).toBe('ask');
    });
  });

  it('accepts subagent result command and push shapes', () => {
    const results: HostCommand = {
      type: 'subagent/results',
      parentSessionId: 'parent-1',
      pendingOnly: true,
      limit: 50,
    };
    const result: HostCommand = { type: 'subagent/result', resultId: 'result-1' };
    const files: HostCommand = {
      type: 'subagent/result-files',
      resultId: 'result-1',
      revision: 2,
      cursor: 'c1',
      limit: 20,
    };
    const diff: HostCommand = {
      type: 'subagent/result-diff',
      resultId: 'result-1',
      revision: 2,
      fileId: 'file-1',
    };
    const cleanup: HostCommand = {
      type: 'subagent/cleanup-plan',
      resultId: 'result-1',
      expectedRevision: 2,
    };
    const resolve: HostCommand = {
      type: 'subagent/request-resolution',
      resultId: 'result-1',
      expectedRevision: 2,
      purpose: 'resolve',
    };
    const apply: HostCommand = {
      type: 'subagent/worktree-action',
      action: 'apply',
      resultId: 'result-1',
      expectedRevision: 2,
    };
    const legacyDiscard: HostCommand = {
      type: 'subagent/worktree-action',
      action: 'discard',
      childSessionId: 'child-1',
    };
    const push: HostPush = {
      type: 'subagent/result-updated',
      parentSessionId: 'parent-1',
      result: {
        resultId: 'result-1',
        revision: 2,
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        taskId: 'task-1',
        batchRunId: 'run-1',
        sourceAttemptId: null,
        targetWorkspaceId: 'ws-1',
        deliveryIntent: 'candidate',
        legacyManual: false,
        candidateGroupId: null,
        candidateLineageId: null,
        candidateGeneration: null,
        predecessorResult: null,
        latestReview: null,
        reviewStatus: 'not-requested',
        latestVerification: null,
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'retained',
        childChanges: { changeSetId: 'cs-child', revision: 1 },
        appliedChanges: null,
        copyState: 'present',
        latestOperationId: null,
        availability: {
          view: { allowed: true },
          apply: { allowed: false, reason: 'unsupported-capability' },
          resolve: { allowed: false, reason: 'unsupported-capability' },
          cleanup: { allowed: false, reason: 'unsupported-capability' },
        },
      },
    };
    expect(results.type).toBe('subagent/results');
    expect(result.type).toBe('subagent/result');
    expect(files.type).toBe('subagent/result-files');
    expect(diff.type).toBe('subagent/result-diff');
    expect(cleanup.type).toBe('subagent/cleanup-plan');
    expect(resolve.type).toBe('subagent/request-resolution');
    expect(apply.type).toBe('subagent/worktree-action');
    expect(legacyDiscard.type).toBe('subagent/worktree-action');
    const gcPreview: HostCommand = { type: 'subagent/worktree-gc-preview' };
    const gc: HostCommand = { type: 'subagent/worktree-gc' };
    expect(gcPreview.type).toBe('subagent/worktree-gc-preview');
    expect(gc.type).toBe('subagent/worktree-gc');
    expect(push.type).toBe('subagent/result-updated');
    if (push.type === 'subagent/result-updated') {
      expect(push.result.childChanges?.changeSetId).toBe('cs-child');
      expect(push.result.appliedChanges).toBeNull();
    }
  });
});
