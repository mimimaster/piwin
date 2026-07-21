import { describe, expect, it } from 'vitest';
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
    expect(sessionSearch.type).toBe('session/search');
    expect(truncate.type).toBe('session/truncate-from');
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
});
