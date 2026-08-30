/**
 * In-browser mock occupancy snapshots for Vite e2e.
 * Live Host remains the product authority; this only mirrors resume/get/push.
 */
import type {
  AssistantUsageMeasurement,
  HostCommand,
  HostPush,
  HostResponse,
  HostStatusData,
  SessionContextSnapshot,
} from '@piwin/contracts';
import { createUnknownSessionContextSnapshot } from '@piwin/contracts';

const MOCK_CONTEXT_TOKENS_USED = 1_280;
const MOCK_CONTEXT_TOKENS_LIMIT = 128_000;

export type MockContextSessionState = {
  revision: number;
  contextVersion: number;
  snapshot: SessionContextSnapshot;
  lastRequestUsage: AssistantUsageMeasurement | null;
};

export function createEmptyMockContextSnapshot(
  sessionId: string,
  nowIso: string,
): SessionContextSnapshot {
  return createUnknownSessionContextSnapshot({
    sessionId,
    revision: 1,
    contextVersion: 1,
    contextBoundary: { activeLeafMessageId: null },
    phase: 'empty',
    reason: 'never-sampled',
    updatedAt: nowIso,
  });
}

export class MockContextTelemetryStore {
  /** WP5 flips this after covering tests exist. */
  advertiseVersion = false;
  private readonly sessions = new Map<string, MockContextSessionState>();

  clear(): void {
    this.sessions.clear();
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  getOrCreate(sessionId: string, nowIso = new Date().toISOString()): MockContextSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const snapshot = createEmptyMockContextSnapshot(sessionId, nowIso);
    const created: MockContextSessionState = {
      revision: snapshot.revision,
      contextVersion: snapshot.contextVersion,
      snapshot,
      lastRequestUsage: null,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  resumeFields(sessionId: string): {
    contextSnapshot: SessionContextSnapshot;
    lastRequestUsage: AssistantUsageMeasurement | null;
  } {
    const state = this.getOrCreate(sessionId);
    return {
      contextSnapshot: state.snapshot,
      lastRequestUsage: state.lastRequestUsage,
    };
  }

  attachCapabilities(
    capabilities: HostStatusData['capabilities'],
  ): HostStatusData['capabilities'] {
    if (!this.advertiseVersion) {
      return capabilities;
    }
    return { ...capabilities, contextTelemetryVersion: 1 };
  }

  handleCommand(command: HostCommand, id: string): HostResponse | null {
    if (command.type !== 'session/context-get') {
      return null;
    }
    const state = this.getOrCreate(command.sessionId);
    return {
      id,
      type: 'response',
      command: 'session/context-get',
      success: true,
      data: state.snapshot,
    };
  }

  noteAssistantReply(input: {
    sessionId: string;
    messageId: string;
    runId: string;
    emitPush: (message: HostPush) => void;
  }): SessionContextSnapshot {
    const nowIso = new Date().toISOString();
    const current = this.getOrCreate(input.sessionId, nowIso);
    const revision = current.revision + 1;
    const lastRequestUsage: AssistantUsageMeasurement = {
      measurementId: `${input.sessionId}:${input.runId}:${input.messageId}`,
      sessionId: input.sessionId,
      runId: input.runId,
      messageId: input.messageId,
      promptTokens: 900,
      completionTokens: 380,
      totalTokens: MOCK_CONTEXT_TOKENS_USED,
      recordedAt: nowIso,
    };
    const snapshot: SessionContextSnapshot = {
      sessionId: input.sessionId,
      revision,
      contextVersion: current.contextVersion,
      contextBoundary: { activeLeafMessageId: input.messageId },
      runId: input.runId,
      responseEvidence: {
        currentRunHasResponse: true,
        historyHasDisplayableResponse: true,
        evidenceMessageId: input.messageId,
      },
      phase: 'idle',
      occupancy: {
        kind: 'known',
        tokensUsed: MOCK_CONTEXT_TOKENS_USED,
        tokensLimit: MOCK_CONTEXT_TOKENS_LIMIT,
        quality: 'estimated',
        coverage: 'complete',
        basis: 'mock-reply',
        sampledAt: nowIso,
      },
      updatedAt: nowIso,
      coveredMessageId: input.messageId,
    };
    current.revision = revision;
    current.snapshot = snapshot;
    current.lastRequestUsage = lastRequestUsage;
    input.emitPush({
      type: 'session/context-updated',
      sessionId: input.sessionId,
      snapshot,
    });
    return snapshot;
  }
}
