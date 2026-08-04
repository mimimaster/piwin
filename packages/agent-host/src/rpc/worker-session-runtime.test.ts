import { describe, expect, it, vi } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '@piwin/contracts';
import type { WorkerEvent, WorkerFrame, WorkerRequest } from '../rpc-sdk-worker-protocol.js';
import { WorkerSessionRuntime, type WorkerPiSessionLike } from './worker-session-runtime.js';
import type { SerializableBlueprint } from './serializable-blueprint.js';

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

function fakeMapper() {
  return {
    map: (raw: unknown): Array<{ event: AgentEvent; envelope: AgentEventEnvelope }> => [
      {
        // The mock Pi session emits `{ type: 'text', text: '...' }`; map it to
        // a valid AgentEvent (message/text_snapshot) with the extracted text.
        event: {
          type: 'message/text_snapshot',
          messageId: 'm1',
          text: (raw as { text?: string } | null)?.text ?? String(raw),
        },
        envelope: { eventId: 'evt-1', sequence: 1 },
      },
    ],
  };
}

function createMockPiSession(): WorkerPiSessionLike {
  let listener: ((raw: unknown) => void) | null = null;
  return {
    id: 'pi-s1',
    prompt: vi.fn(async () => {
      listener?.({ type: 'text', text: 'mock reply' });
    }),
    steer: vi.fn(async () => {
      listener?.({ type: 'text', text: 'steered' });
    }),
    followUp: vi.fn(async () => {
      listener?.({ type: 'text', text: 'followed' });
    }),
    abort: vi.fn(async () => undefined),
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  };
}

function createRequest(overrides: Partial<WorkerRequest> = {}): WorkerRequest {
  return {
    type: 'request',
    id: 'req-1',
    method: 'session/create',
    payload: {
      method: 'session/create',
      productSessionId: 'ps-1',
      blueprint: minimalBlueprint,
    },
    ...overrides,
  };
}

describe('WorkerSessionRuntime', () => {
  it('creates a blueprint session and attaches the product session id', async () => {
    const frames: WorkerFrame[] = [];
    const createPiSession = vi.fn(async () => createMockPiSession());
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession,
      eventMapper: fakeMapper(),
    });

    await runtime.handleRequest(createRequest());
    expect(createPiSession).toHaveBeenCalledWith(
      expect.objectContaining({ productSessionId: 'ps-1', blueprint: minimalBlueprint }),
    );
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-1',
      success: true,
      data: { sessionId: 'pi-s1' },
    });
  });

  it('prompts a session and streams normalized events', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'req-2',
      method: 'session/prompt',
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'hello' },
    });

    expect(frames).toContainEqual({
      type: 'event',
      sessionId: 'pi-s1',
      event: { type: 'message/text_snapshot', messageId: 'm1', text: 'mock reply' },
    } satisfies WorkerEvent);
    expect(frames).toContainEqual({ type: 'response', id: 'req-2', success: true, data: {} });
  });

  it('prompting an unknown session fails loudly', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'req-x',
      method: 'session/prompt',
      payload: { method: 'session/prompt', sessionId: 'nope', text: 'hi' },
    });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'req-x',
      success: false,
      error: 'unknown session: nope',
    });
  });

  it('routes steer and follow-up to the session', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'r1',
      method: 'session/steer',
      payload: { method: 'session/steer', sessionId: 'ps-1', message: 'go on' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'r2',
      method: 'session/follow-up',
      payload: { method: 'session/follow-up', sessionId: 'ps-1', message: 'thanks' },
    });

    expect(frames).toContainEqual({
      type: 'event',
      sessionId: 'pi-s1',
      event: { type: 'message/text_snapshot', messageId: 'm1', text: 'steered' },
    } satisfies WorkerEvent);
    expect(frames).toContainEqual({
      type: 'event',
      sessionId: 'pi-s1',
      event: { type: 'message/text_snapshot', messageId: 'm1', text: 'followed' },
    } satisfies WorkerEvent);
  });

  it('aborts a session and then drop removes it', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest(createRequest());

    await runtime.handleRequest({
      type: 'request',
      id: 'r3',
      method: 'session/abort',
      payload: { method: 'session/abort', sessionId: 'ps-1' },
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'r4',
      method: 'session/drop',
      payload: { method: 'session/drop', sessionId: 'ps-1' },
    });
    // After drop, prompt fails.
    await runtime.handleRequest({
      type: 'request',
      id: 'r5',
      method: 'session/prompt',
      payload: { method: 'session/prompt', sessionId: 'ps-1', text: 'late' },
    });
    expect(frames).toContainEqual({ type: 'response', id: 'r3', success: true, data: {} });
    expect(frames).toContainEqual({ type: 'response', id: 'r4', success: true, data: {} });
    expect(frames).toContainEqual({
      type: 'response',
      id: 'r5',
      success: false,
      error: 'unknown session: ps-1',
    });
  });

  it('legacy subagent-task create returns a synthetic session id', async () => {
    const frames: WorkerFrame[] = [];
    const runtime = new WorkerSessionRuntime({
      sendFrame: (frame) => frames.push(frame),
      createPiSession: async () => createMockPiSession(),
      eventMapper: fakeMapper(),
    });
    await runtime.handleRequest({
      type: 'request',
      id: 'r6',
      method: 'session/create',
      payload: {
        method: 'session/create',
        projectPath: '/tmp/p',
        workingDirectory: '/tmp/p',
        isolation: 'readonly',
      },
    });
    const created = frames.find(
      (frame): frame is Extract<WorkerFrame, { type: 'response' }> =>
        frame.type === 'response' && frame.id === 'r6',
    );
    expect(created?.success).toBe(true);
    expect(created?.data).toMatchObject({ projectPath: '/tmp/p' });
  });
});
