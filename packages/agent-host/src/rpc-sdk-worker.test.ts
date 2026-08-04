import { describe, expect, it } from 'vitest';
import {
  parseWorkerFrame,
  serializeWorkerRequest,
  type WorkerRequest,
} from './rpc-sdk-worker-protocol.js';
import type { SerializableBlueprint } from './rpc/serializable-blueprint.js';

const minimalBlueprint: SerializableBlueprint = {
  protocolVersion: 1,
  snapshotId: 'snap-1',
  settingsRevision: 'r1',
  workingDirectory: '/tmp/work',
  scope: { kind: 'general' },
  resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
  contextManifest: { agentsFiles: [] },
  tools: {
    enabledFamilies: [],
    piBuiltinToolNames: [],
    customToolNames: [],
    enabledMcpServerIds: [],
  },
  activeSkillPaths: [],
  activeExtensionPaths: [],
  activePromptPaths: [],
};

describe('parseWorkerFrame', () => {
  it('parses a valid response frame', () => {
    const line = JSON.stringify({
      type: 'response',
      id: 'req-1',
      success: true,
      data: { sessionId: 's1' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('response');
    expect(frame?.type === 'response' && frame.id).toBe('req-1');
  });

  it('parses a valid event frame', () => {
    const line = JSON.stringify({
      type: 'event',
      sessionId: 's1',
      event: { type: 'text', text: 'hello' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('event');
  });

  it('parses a tool-call frame (Phase 7 proxy)', () => {
    const line = JSON.stringify({
      type: 'tool-call',
      id: 'tc-1',
      sessionId: 's1',
      toolName: 'web_search',
      args: { query: 'piwin' },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('tool-call');
    if (frame?.type === 'tool-call') {
      expect(frame.toolName).toBe('web_search');
      expect(frame.args).toEqual({ query: 'piwin' });
    }
  });

  it('parses a hello frame', () => {
    const line = JSON.stringify({
      type: 'hello',
      protocolVersion: 1,
      workerPid: 1234,
      capabilities: { toolProxy: true, steer: true, followUp: true, preparedPrompt: true },
    });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('hello');
  });

  it('parses a shutdown frame (Phase 7 §4.1)', () => {
    const line = JSON.stringify({ type: 'shutdown', reason: 'parent-dispose' });
    const frame = parseWorkerFrame(line);
    expect(frame?.type).toBe('shutdown');
    if (frame?.type === 'shutdown') {
      expect(frame.reason).toBe('parent-dispose');
    }
  });

  it('returns undefined for malformed JSON', () => {
    expect(parseWorkerFrame('not json')).toBeUndefined();
  });

  it('returns undefined for unknown frame type', () => {
    const line = JSON.stringify({ type: 'unknown', id: 'x' });
    expect(parseWorkerFrame(line)).toBeUndefined();
  });

  it('returns undefined for missing required fields', () => {
    expect(parseWorkerFrame(JSON.stringify({ type: 'response' }))).toBeUndefined();
    expect(parseWorkerFrame(JSON.stringify({ type: 'event' }))).toBeUndefined();
    expect(parseWorkerFrame(JSON.stringify({ type: 'tool-call', id: 'x' }))).toBeUndefined();
  });
});

describe('serializeWorkerRequest', () => {
  it('serializes a blueprint-first session/create request', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'req-1',
      method: 'session/create',
      payload: {
        method: 'session/create',
        productSessionId: 'ps-1',
        blueprint: minimalBlueprint,
      },
    };
    const parsed = JSON.parse(serializeWorkerRequest(request));
    expect(parsed.type).toBe('request');
    expect(parsed.payload.productSessionId).toBe('ps-1');
    expect(parsed.payload.blueprint.snapshotId).toBe('snap-1');
    expect(parsed.payload.blueprint.protocolVersion).toBe(1);
  });

  it('serializes a prepared prompt with native images', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'r2',
      method: 'session/prompt',
      payload: {
        method: 'session/prompt',
        sessionId: 's1',
        text: 'describe this',
        images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
      },
    };
    const parsed = JSON.parse(serializeWorkerRequest(request)) as WorkerRequest;
    expect(parsed.payload).toMatchObject({
      sessionId: 's1',
      text: 'describe this',
      images: [{ mimeType: 'image/png', dataBase64: 'AAAA' }],
    });
  });

  it('serializes steer and follow-up requests', () => {
    const steer: WorkerRequest = {
      type: 'request',
      id: 'r1',
      method: 'session/steer',
      payload: { method: 'session/steer', sessionId: 's1', message: 'go on' },
    };
    const followUp: WorkerRequest = {
      type: 'request',
      id: 'r2',
      method: 'session/follow-up',
      payload: { method: 'session/follow-up', sessionId: 's1', message: 'thanks' },
    };
    expect(JSON.parse(serializeWorkerRequest(steer)).method).toBe('session/steer');
    expect(JSON.parse(serializeWorkerRequest(followUp)).method).toBe('session/follow-up');
  });

  it('serializes the legacy subagent-task create payload', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'r3',
      method: 'session/create',
      payload: {
        method: 'session/create',
        projectPath: '/tmp/project',
        workingDirectory: '/tmp/project',
        isolation: 'readonly',
      },
    };
    const parsed = JSON.parse(serializeWorkerRequest(request));
    expect(parsed.payload.projectPath).toBe('/tmp/project');
    expect(parsed.payload.isolation).toBe('readonly');
  });
});
