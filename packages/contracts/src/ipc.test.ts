import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope } from './host.js';
import type { HostCommand, HostPush } from './ipc.js';
import { toMediaAttachmentRef } from './ipc.js';

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

  it('accepts CE process/session command shapes', () => {
    const processStart: HostCommand = {
      type: 'process/start',
      input: {
        command: 'node',
        argv: ['server.js'],
        cwd: '/tmp/project',
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
    expect(processStart.type).toBe('process/start');
    expect(sessionPin.type).toBe('session/pin');
    expect(sessionRename.type).toBe('session/rename');
    expect(sessionArchive.type).toBe('session/archive');
    expect(sessionDelete.type).toBe('session/delete');
    expect(sessionDuplicate.type).toBe('session/duplicate');
    expect(sessionSearch.type).toBe('session/search');
    expect(truncate.type).toBe('session/truncate-from');
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

  it('accepts session/spawn with profileId, model, and thinkingLevel', () => {
    const spawn: HostCommand = {
      type: 'session/spawn',
      parentSessionId: 's1',
      task: 'explore the auth module',
      profileId: 'explorer',
      model: {
        protocol: 'openai-compatible',
        providerId: 'local-provider',
        modelId: 'fast-coder',
      },
      thinkingLevel: 'low',
    };
    expect(spawn.type).toBe('session/spawn');
    if (spawn.type === 'session/spawn') {
      expect(spawn.profileId).toBe('explorer');
      expect(spawn.model?.modelId).toBe('fast-coder');
      expect(spawn.thinkingLevel).toBe('low');
    }
  });

  it('accepts legacy session/spawn without profile fields (backward compat)', () => {
    const spawn: HostCommand = {
      type: 'session/spawn',
      parentSessionId: 's1',
      task: 'do a thing',
      mode: 'worktree',
      applyPolicy: 'auto',
    };
    expect(spawn.type).toBe('session/spawn');
    if (spawn.type === 'session/spawn') {
      expect(spawn.profileId).toBeUndefined();
      expect(spawn.model).toBeUndefined();
      expect(spawn.thinkingLevel).toBeUndefined();
      expect(spawn.mode).toBe('worktree');
    }
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

  it('accepts usage/update and process AgentEvent shapes via HostPush', () => {
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
    const processPush: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'process/started',
        process: {
          id: 'p1',
          command: 'node',
          argv: ['server.js'],
          cwd: '/tmp/project',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      },
    };
    expect(usagePush.event.type).toBe('usage/update');
    expect(processPush.event.type).toBe('process/started');
  });

  it('accepts run/phase and run/terminal AgentEvent shapes', () => {
    const phase: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/phase',
        sessionId: 's1',
        runId: 'r1',
        phase: 'accepted',
        at: new Date().toISOString(),
      },
    };
    const terminal: HostPush = {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'r1',
        outcome: 'completed',
        at: new Date().toISOString(),
      },
    };
    expect(phase.event.type).toBe('run/phase');
    expect(terminal.event.type).toBe('run/terminal');
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
});
