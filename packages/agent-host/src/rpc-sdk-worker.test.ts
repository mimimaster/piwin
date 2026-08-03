import { describe, expect, it } from 'vitest';
import {
  parseWorkerFrame,
  serializeWorkerRequest,
  type WorkerRequest,
} from './rpc-sdk-worker-protocol.js';

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
  });
});

describe('serializeWorkerRequest', () => {
  it('serializes a request to JSONL', () => {
    const request: WorkerRequest = {
      type: 'request',
      id: 'req-1',
      method: 'session/create',
      payload: {
        method: 'session/create',
        projectPath: '/tmp/project',
        workingDirectory: '/tmp/project',
        isolation: 'readonly',
      },
    };
    const line = serializeWorkerRequest(request);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe('request');
    expect(parsed.id).toBe('req-1');
    expect(parsed.method).toBe('session/create');
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
    const roundTrip = JSON.parse(serializeWorkerRequest(steer)) as WorkerRequest;
    expect(roundTrip.payload).toMatchObject({ sessionId: 's1', message: 'go on' });
  });
});
