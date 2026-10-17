import { describe, expect, it } from 'vitest';
import {
  buildSessionCreateInput,
  resolveDraftCreateScopeForAgent,
  resolveSessionCreateLocation,
  shouldMoveExternalDraftToConversations,
} from './session-create-input';

const piModel = { providerId: 'acme', modelId: 'gpt-test' } as const;

describe('buildSessionCreateInput', () => {
  it('carries the Pi composer profile for a Pi session', () => {
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      model: piModel,
      thinkingLevel: 'medium',
    });
    expect(input.model).toEqual(piModel);
    expect(input.thinkingLevel).toBe('medium');
    expect(input.agentId).toBeUndefined();
  });

  it('carries the agent identity and its own model/effort ids', () => {
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      agentId: 'grok',
      backendModelId: 'grok-4',
      backendEffortId: 'high',
    });
    expect(input.agentId).toBe('grok');
    expect(input.backendModelId).toBe('grok-4');
    expect(input.backendEffortId).toBe('high');
  });

  it('never mixes a Pi model ref into an external agent session', () => {
    // The composer still holds a Pi selection while the draft points at Grok;
    // sending both would hand the Pi ref to a runtime that cannot resolve it.
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      agentId: 'grok',
      backendModelId: 'grok-4',
      model: piModel,
      thinkingLevel: 'medium',
    });
    expect(input.model).toBeUndefined();
    expect(input.thinkingLevel).toBeUndefined();
    expect(input.backendModelId).toBe('grok-4');
  });

  it('treats an explicit pi agentId as the Pi path', () => {
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      agentId: 'pi',
      model: piModel,
      thinkingLevel: 'low',
    });
    expect(input.agentId).toBeUndefined();
    expect(input.model).toEqual(piModel);
    expect(input.thinkingLevel).toBe('low');
  });

  it('passes the project key through for a project-scoped create', () => {
    const input = buildSessionCreateInput('live', {
      useGeneral: false,
      projectKey: '/repo/app',
    });
    expect(input.projectPath).toBe('/repo/app');
  });

  it('copies the draft mount/switches arrays so later edits cannot mutate them', () => {
    const knowledgeBaseIds = ['kb-1'];
    const disabledMcpServerIds = ['mcp-1'];
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      knowledgeBaseIds,
      disabledMcpServerIds,
    });
    expect(input.knowledgeBaseIds).toEqual(['kb-1']);
    expect(input.disabledMcpServerIds).toEqual(['mcp-1']);
    expect(input.knowledgeBaseIds).not.toBe(knowledgeBaseIds);
  });

  it('omits empty mount/switches lists rather than sending empty arrays', () => {
    const input = buildSessionCreateInput('live', {
      useGeneral: true,
      knowledgeBaseIds: [],
      disabledMcpServerIds: [],
    });
    expect(input.knowledgeBaseIds).toBeUndefined();
    expect(input.disabledMcpServerIds).toBeUndefined();
  });
});

describe('resolveSessionCreateLocation', () => {
  const projectScope = { kind: 'project' as const, projectPath: '/repo/app' };
  const generalScope = { kind: 'general' as const };

  it('keeps an explicit project binding', () => {
    expect(
      resolveSessionCreateLocation({
        requestedScope: projectScope,
        agentId: 'grok',
        activeScope: generalScope,
      }),
    ).toEqual({ useGeneral: false, projectKey: '/repo/app' });
  });

  it('defaults Grok without a project binding to Conversations', () => {
    expect(
      resolveSessionCreateLocation({
        agentId: 'grok',
        activeScope: projectScope,
      }),
    ).toEqual({ useGeneral: true });
  });

  it('still inherits the open project for a Pi session', () => {
    expect(
      resolveSessionCreateLocation({
        activeScope: projectScope,
      }),
    ).toEqual({ useGeneral: false, projectKey: '/repo/app' });
  });
});

describe('resolveDraftCreateScopeForAgent', () => {
  const projectScope = { kind: 'project' as const, projectPath: '/repo/app' };

  it('does not treat an open project as a Grok binding', () => {
    expect(
      resolveDraftCreateScopeForAgent({
        agentId: 'grok',
        draftScope: projectScope,
        explicitDraftScope: null,
      }),
    ).toEqual({ kind: 'general' });
  });

  it('keeps Grok under a project folder + draft', () => {
    expect(
      resolveDraftCreateScopeForAgent({
        agentId: 'grok',
        draftScope: projectScope,
        explicitDraftScope: projectScope,
      }),
    ).toEqual(projectScope);
  });

  it('still inherits the open project for Pi', () => {
    expect(
      resolveDraftCreateScopeForAgent({
        draftScope: projectScope,
        explicitDraftScope: null,
      }),
    ).toEqual(projectScope);
  });
});

describe('shouldMoveExternalDraftToConversations', () => {
  it('leaves an open project when picking Grok on an empty unbound composer', () => {
    expect(
      shouldMoveExternalDraftToConversations({
        agentId: 'grok',
        activeSessionId: null,
        activeScopeKind: 'project',
        explicitDraftScopeKind: null,
      }),
    ).toBe(true);
  });

  it('does not leave a folder + Grok draft', () => {
    expect(
      shouldMoveExternalDraftToConversations({
        agentId: 'grok',
        activeSessionId: null,
        activeScopeKind: 'project',
        explicitDraftScopeKind: 'project',
      }),
    ).toBe(false);
  });
});
