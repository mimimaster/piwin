import { describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse, SessionSummary } from '@piwin/contracts';
import { createRemoteCapabilities, projectRemotePush, projectRemoteResponse } from './remote-projection.js';

const session: SessionSummary = {
  id: 'grok-session', name: 'Research', scope: { kind: 'project', projectPath: '/private/project' },
  workingDirectory: '/private/project', projectPath: '/private/project',
  updatedAt: '2026-10-02T14:00:00Z', messageCount: 1,
  backend: { agentId: 'grok' },
};
const context = { hostInstanceId: 'host-1', mode: 'sdk' as const, capabilities: createRemoteCapabilities() };
function project(command: HostCommand, data: unknown): unknown {
  const response: HostResponse = { type: 'response', command: command.type, success: true, data };
  const projected = projectRemoteResponse(command, response, context);
  if (!projected.success) throw new Error(projected.error);
  return projected.data;
}

describe('remote session backend identity', () => {
  it('preserves the agent prefix in both list transports without exposing native binding data', () => {
    const rawSession = { ...session, backend: {
      agentId: 'grok', backendSessionId: 'private-native-id', modelId: 'native-option',
      cwd: '/private/project', pluginRevision: 'private-adapter-revision',
    } };
    const listed = project({ type: 'session/list', scopeRef: { kind: 'general' } }, { sessions: [rawSession] });
    const paged = project({ type: 'session/list-page', query: { scope: { kind: 'general' }, limit: 20, lifecycle: 'active', order: 'updated' } }, {
      status: 'page', sessions: [rawSession], page: { revision: 'r1', pageIndex: 0, pageCount: 1, totalCount: 1 },
    });
    for (const projected of [listed, paged]) {
      expect(projected).toMatchObject({ sessions: [{ backend: { agentId: 'grok' } }] });
      const backend = (projected as { sessions: { backend: unknown }[] }).sessions[0]?.backend;
      expect(backend).toEqual({ agentId: 'grok' });
      expect(JSON.stringify(projected)).not.toContain('/private/project');
      expect(JSON.stringify(projected)).not.toContain('private-native-id');
    }
  });

  it.each(['created', 'updated'] as const)('retains backend identity on the %s index push', (op) => {
    const projected = projectRemotePush({ type: 'session/index-updated', op, sessionId: session.id, session });
    expect(projected).toMatchObject({ session: { backend: { agentId: 'grok' } } });
  });

  it('keeps unknown agent identities and leaves default Pi sessions unlabelled', () => {
    const projected = project({ type: 'session/list' }, { sessions: [
      { ...session, id: 'new-agent', backend: { agentId: 'future-agent' } },
      { ...session, id: 'pi', backend: { agentId: 'pi' } },
      { ...session, id: 'old', backend: undefined },
    ] });
    expect(projected).toMatchObject({ sessions: [
      { backend: { agentId: 'future-agent' } }, { sessionId: 'pi' }, { sessionId: 'old' },
    ] });
    const sessions = (projected as { sessions: { backend?: unknown }[] }).sessions;
    expect(sessions[1]).not.toHaveProperty('backend');
    expect(sessions[2]).not.toHaveProperty('backend');
  });
});
