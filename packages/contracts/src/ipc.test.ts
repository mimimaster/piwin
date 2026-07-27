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

  it('accepts CE memory/process/session command shapes', () => {
    const memoryList: HostCommand = { type: 'memory/list', filter: { scope: 'global' } };
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
    expect(memoryList.type).toBe('memory/list');
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
});
