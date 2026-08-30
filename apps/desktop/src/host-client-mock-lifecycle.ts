import { buildForkSessionName } from '@piwin/session/fork-session-name';
import {
  listMockBranchPoints,
  mockOffPathWrites,
  switchMockBranch,
  truncateMockSubtree,
  visibleMockTranscript,
} from './host-client-mock-tree.js';
import { copyMockAssemblySummaries } from './host-client-mock-assembly.js';
import {
  mockSessionMessageResponse,
} from './host-client-mock-helpers.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  ProductSessionOrigin,
  SessionTranscriptMessage,
} from '@piwin/contracts';

export async function handleMockSessionLifecycleCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'session/pin': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/pin',
            success: false,
            error: 'unknown session',
          };
        }
        session.isPinned = true;
        session.pinnedAt = new Date().toISOString();
        return {
          id,
          type: 'response',
          command: 'session/pin',
          success: true,
          data: {
            sessionId: command.sessionId,
            isPinned: true,
            pinnedAt: session.pinnedAt,
            session: host.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/unpin': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/unpin',
            success: false,
            error: 'unknown session',
          };
        }
        session.isPinned = false;
        delete session.pinnedAt;
        return {
          id,
          type: 'response',
          command: 'session/unpin',
          success: true,
          data: {
            sessionId: command.sessionId,
            isPinned: false,
            session: host.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/rename': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/rename',
            success: false,
            error: 'unknown session',
          };
        }
        const name = command.name.trim().replace(/\s+/g, ' ');
        if (!name) {
          return {
            id,
            type: 'response',
            command: 'session/rename',
            success: false,
            error: 'Session name must not be empty',
          };
        }
        session.name = name.slice(0, 120);
        session.nameSource = 'user';
        return {
          id,
          type: 'response',
          command: 'session/rename',
          success: true,
          data: {
            sessionId: command.sessionId,
            name: session.name,
            session: host.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/archive': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/archive',
            success: false,
            error: 'unknown session',
          };
        }
        session.isArchived = true;
        session.archivedAt = new Date().toISOString();
        session.isPinned = false;
        delete session.pinnedAt;
        return {
          id,
          type: 'response',
          command: 'session/archive',
          success: true,
          data: {
            sessionId: command.sessionId,
            isArchived: true,
            archivedAt: session.archivedAt,
            session: host.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/unarchive': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/unarchive',
            success: false,
            error: 'unknown session',
          };
        }
        session.isArchived = false;
        delete session.archivedAt;
        return {
          id,
          type: 'response',
          command: 'session/unarchive',
          success: true,
          data: {
            sessionId: command.sessionId,
            isArchived: false,
            session: host.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/delete': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/delete',
            success: false,
            error: 'unknown session',
          };
        }
        if (session.isArchived !== true && command.force !== true) {
          return {
            id,
            type: 'response',
            command: 'session/delete',
            success: false,
            error: 'Session must be archived before permanent delete (or pass force: true)',
          };
        }
        host.sessions.delete(command.sessionId);
        host.contextTelemetry.deleteSession(command.sessionId);
        return {
          id,
          type: 'response',
          command: 'session/delete',
          success: true,
          data: { sessionId: command.sessionId, deleted: true },
        };
      }

      case 'session/duplicate': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/duplicate',
            success: false,
            error: 'unknown session',
          };
        }
        const newId = crypto.randomUUID();
        const baseName = session.name ?? `session-${command.sessionId.slice(0, 8)}`;
        const targetScope = command.targetScope ?? session.scope;
        const targetProjectPath =
          targetScope?.kind === 'project' ? targetScope.projectPath : session.projectPath;
        const name =
          typeof command.name === 'string' && command.name.trim()
            ? command.name.trim()
            : command.targetScope
              ? baseName
              : baseName.startsWith('Copy of ')
                ? `${baseName} (2)`
                : `Copy of ${baseName}`;
        const messageIdMap = new Map<string, string>();
        const clonedTranscript = visibleMockTranscript(session).map((message) => {
          const next: SessionTranscriptMessage = {
            id: crypto.randomUUID(),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            status: message.status === 'streaming' ? 'done' : message.status,
          };
          messageIdMap.set(message.id, next.id);
          if (message.runId !== undefined) next.runId = message.runId;
          if (message.thinking !== undefined) {
            next.thinking = message.thinking;
          }
          if (message.tools) {
            next.tools = message.tools.map((tool) => ({ ...tool }));
          }
          if (message.attachments) {
            next.attachments = message.attachments.map((attachment) => ({ ...attachment }));
          }
          return next;
        });
        copyMockAssemblySummaries(host, command.sessionId, newId, messageIdMap);
        const origin: ProductSessionOrigin = {
          kind: 'duplicate',
          sourceSessionId: command.sessionId,
          ...(session.name ? { sourceSessionNameSnapshot: session.name } : {}),
          createdAt: new Date().toISOString(),
        };
        host.sessions.set(newId, {
          projectPath: targetProjectPath,
          ...(targetScope ? { scope: targetScope } : {}),
          ...(targetScope?.kind === 'project' ? { workingDirectory: targetScope.projectPath } : {}),
          events: [],
          transcript: clonedTranscript,
          name,
          isPinned: false,
          isArchived: false,
          origin,
        });
        const duplicatedSession = host.sessions.get(newId);
        if (!duplicatedSession) {
          throw new Error(`Mock duplicate session was not stored: ${newId}`);
        }
        const summary = host.mockSessionSummary(newId, duplicatedSession);
        return {
          id,
          type: 'response',
          command: 'session/duplicate',
          success: true,
          data: {
            sessionId: newId,
            sourceSessionId: command.sessionId,
            session: summary,
            ...mockSessionMessageResponse(newId, clonedTranscript, command.messageProjection),
          },
        };
      }
      case 'session/fork': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/fork',
            success: false,
            error: 'unknown session',
          };
        }
        const visibleSource = visibleMockTranscript(session);
        let messageIndex =
          command.messageId === undefined
            ? -1
            : visibleSource.findIndex((message) => message.id === command.messageId);
        if (command.messageId === undefined) {
          for (let index = visibleSource.length - 1; index >= 0; index -= 1) {
            const candidate = visibleSource[index];
            if (candidate?.role === 'assistant' && candidate.status === 'done') {
              messageIndex = index;
              break;
            }
          }
        }
        if (messageIndex === -1) {
          return {
            id,
            type: 'response',
            command: 'session/fork',
            success: false,
            error: 'session-fork-message-not-found',
          };
        }
        const sourceMessage = visibleSource[messageIndex]!;
        if (sourceMessage.role !== 'assistant' || sourceMessage.status !== 'done') {
          return {
            id,
            type: 'response',
            command: 'session/fork',
            success: false,
            error: 'session-fork-message-incomplete',
          };
        }
        const newForkId = crypto.randomUUID();
        const baseName = session.name ?? `session-${command.sessionId.slice(0, 8)}`;
        const forkName =
          typeof command.name === 'string' && command.name.trim()
            ? command.name.trim()
            : buildForkSessionName(
                baseName,
                command.sessionId,
                host.mockGetDirectForkNames(command.sessionId),
              );
        const rootSessionId =
          session.origin?.kind === 'fork' ? session.origin.rootSessionId : command.sessionId;
        const messageIdMap = new Map<string, string>();
        const retainedRunIds = new Set<string>();
        const forkTranscript = visibleSource.slice(0, messageIndex + 1).map((message) => {
          const next: SessionTranscriptMessage = {
            id: crypto.randomUUID(),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            status: message.status === 'streaming' ? 'done' : message.status,
          };
          messageIdMap.set(message.id, next.id);
          if (message.runId !== undefined) {
            next.runId = message.runId;
            retainedRunIds.add(message.runId);
          }
          if (message.thinking !== undefined) {
            next.thinking = message.thinking;
          }
          if (message.tools) {
            next.tools = message.tools.map((tool) => ({ ...tool }));
          }
          if (message.attachments) {
            next.attachments = message.attachments.map((attachment) => ({ ...attachment }));
          }
          return next;
        });
        copyMockAssemblySummaries(host, command.sessionId, newForkId, messageIdMap, retainedRunIds);
        const origin: ProductSessionOrigin = {
          kind: 'fork',
          rootSessionId,
          sourceSessionId: command.sessionId,
          ...(session.name ? { sourceSessionNameSnapshot: session.name } : {}),
          sourceMessageId: sourceMessage.id,
          sourceMessageRole: 'assistant',
          sourceMessagePreview: sourceMessage.text.slice(0, 200),
          sourceMessageCreatedAt: sourceMessage.createdAt,
          workspaceStrategy: command.workspaceStrategy,
          createdAt: new Date().toISOString(),
        };
        host.sessions.set(newForkId, {
          projectPath: session.projectPath,
          events: [],
          transcript: forkTranscript,
          name: forkName,
          isPinned: false,
          isArchived: false,
          origin,
        });
        const forkedSession = host.sessions.get(newForkId);
        if (!forkedSession) {
          throw new Error(`Mock fork session was not stored: ${newForkId}`);
        }
        const forkSummary = host.mockSessionSummary(newForkId, forkedSession);
        return {
          id,
          type: 'response',
          command: 'session/fork',
          success: true,
          data: {
            sessionId: newForkId,
            sourceSessionId: command.sessionId,
            session: forkSummary,
            ...mockSessionMessageResponse(newForkId, forkTranscript, command.messageProjection),
            origin,
          },
        };
      }
      case 'session/lineage': {
        return {
          id,
          type: 'response',
          command: 'session/lineage',
          success: true,
          data: host.mockBuildSessionLineage(command.sessionId),
        };
      }
      case 'session/model-context-summary': {
        return {
          id,
          type: 'response',
          command: 'session/model-context-summary',
          success: true,
          data: {
            sessionId: command.sessionId,
            coverage: 'assembly-only',
            summaries: host.mockAssemblySummaries.get(command.sessionId) ?? [],
          },
        };
      }
      case 'session/search': {
        const query = command.query.query.trim().toLowerCase();
        const requestedLimit = command.query.limit ?? 20;
        const limit =
          Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(Math.floor(requestedLimit), 100)
            : 20;
        const hits = [...host.sessions.entries()]
          .map(([sessionId, value]) => ({
            sessionId,
            value,
            summary: host.mockSessionSummary(sessionId, value),
          }))
          .filter(({ sessionId, value, summary }) => {
            if (command.query.scope?.kind === 'general' && summary.scope.kind !== 'general') {
              return false;
            }
            if (
              command.query.scope?.kind === 'project' &&
              (summary.scope.kind !== 'project' ||
                summary.scope.projectPath !== command.query.scope.projectPath)
            ) {
              return false;
            }
            if (command.query.projectPath && value.projectPath !== command.query.projectPath) {
              return false;
            }
            if (
              command.query.lifecycle === 'archived'
                ? summary.isArchived !== true
                : command.query.lifecycle === 'active' && summary.isArchived === true
            ) {
              return false;
            }
            if (command.query.pinnedOnly === true && summary.isPinned !== true) return false;
            if (!query) return true;
            const hay = `${sessionId} ${value.projectPath} ${summary.name}`.toLowerCase();
            return (
              hay.includes(query) ||
              value.transcript.some((m) => m.text.toLowerCase().includes(query))
            );
          })
          .slice(0, limit)
          .map(({ sessionId, value, summary }) => ({
            sessionId,
            projectPath: value.projectPath,
            scope: summary.scope,
            name: summary.name,
            snippet: value.transcript[0]?.text?.slice(0, 80),
            updatedAt: summary.updatedAt,
            isPinned: summary.isPinned === true,
          }));
        return {
          id,
          type: 'response',
          command: 'session/search',
          success: true,
          data: { query: command.query.query, hits },
        };
      }
      case 'session/cold-storage-status': {
        const cold = host.mockConfig.session?.coldStorage;
        return {
          id,
          type: 'response',
          command: 'session/cold-storage-status',
          success: true,
          data: {
            config: cold ?? {
              enabled: false,
              minArchivedAgeDays: 30,
            },
            packOutputDirValid: Boolean(cold?.packOutputDir),
            localPayloadBytes: 0,
            overBudget: false,
            eligibleCount: 0,
            residualTransactions: [],
            missingPackSessionIds: [],
          },
        };
      }
      case 'session/cold-storage-plan':
        return {
          id,
          type: 'response',
          command: 'session/cold-storage-plan',
          success: false,
          error: 'Cold storage planning is not available in the mock host.',
        };
      case 'session/cold-storage-execute':
        return {
          id,
          type: 'response',
          command: 'session/cold-storage-execute',
          success: false,
          error: 'Cold storage execute is not available in the mock host.',
        };
      case 'session/cold-storage-restore':
      case 'session/cold-storage-import': {
        const sessionId =
          command.type === 'session/cold-storage-restore'
            ? command.sessionId
            : command.packPath;
        const session = host.sessions.get(
          command.type === 'session/cold-storage-restore' ? command.sessionId : '',
        );
        if (command.type === 'session/cold-storage-restore' && session) {
          delete session.storage;
        }
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            sessionId: command.type === 'session/cold-storage-restore' ? command.sessionId : sessionId,
            packId: 'mock-pack',
            packPath: command.type === 'session/cold-storage-restore' ? (command.packPath ?? '') : command.packPath,
            createdIndexRecord: false,
            storage: { state: 'local' },
          },
        };
      }
      case 'session/cold-storage-reconcile':
        return {
          id,
          type: 'response',
          command: 'session/cold-storage-reconcile',
          success: true,
          data: { recovered: [], updatedSessionIds: [], reports: [] },
        };
      case 'session/pack-list':
        return {
          id,
          type: 'response',
          command: 'session/pack-list',
          success: true,
          data: { directory: command.directory, packs: [] },
        };
      case 'session/branch-list': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/branch-list',
            success: false,
            error: 'unknown session',
          };
        }
        return {
          id,
          type: 'response',
          command: 'session/branch-list',
          success: true,
          data: {
            sessionId: command.sessionId,
            revision: `mock-branch:${visibleMockTranscript(session).length}`,
            branchPoints: listMockBranchPoints(session),
          },
        };
      }
      case 'session/branch-switch': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: false,
            error: 'unknown session',
          };
        }
        if (host.mockActiveRunIds.get(command.sessionId)) {
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: true,
            data: { status: 'run-active' },
          };
        }
        const offPathWrites = mockOffPathWrites(session, command.targetMessageId);
        if (offPathWrites !== null && command.confirm !== true) {
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: true,
            data: { status: 'needs-confirmation', offPathWrites },
          };
        }
        try {
          const activeLeafMessageId = switchMockBranch(session, command.targetMessageId);
          host.emitPush({
            type: 'session/branch-updated',
            sessionId: command.sessionId,
            activeLeafMessageId,
            branchPointCount: listMockBranchPoints(session).length,
          });
          const visible = visibleMockTranscript(session);
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: true,
            data: {
              status: 'switched',
              sessionId: command.sessionId,
              activeLeafMessageId,
              session: host.mockSessionSummary(command.sessionId, session),
              ...mockSessionMessageResponse(
                command.sessionId,
                visible,
                command.messageProjection ?? 'tail',
              ),
            },
          };
        } catch (error) {
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: false,
            error: error instanceof Error ? error.message : 'branch switch failed',
          };
        }
      }
      case 'session/truncate-from': {
        const session = host.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/truncate-from',
            success: false,
            error: 'unknown session',
          };
        }
        const truncated = truncateMockSubtree(session, command.messageId);
        if (!truncated.found) {
          return {
            id,
            type: 'response',
            command: 'session/truncate-from',
            success: false,
            error: `Message not found in transcript: ${command.messageId}`,
          };
        }
        host.emitPush({
          type: 'session/branch-updated',
          sessionId: command.sessionId,
          activeLeafMessageId: session.activeLeafMessageId ?? null,
          branchPointCount: listMockBranchPoints(session).length,
        });
        return {
          id,
          type: 'response',
          command: 'session/truncate-from',
          success: true,
          data: {
            sessionId: command.sessionId,
            removedCount: truncated.removedCount,
            remainingCount: truncated.remainingCount,
            ...mockSessionMessageResponse(
              command.sessionId,
              visibleMockTranscript(session),
              command.messageProjection,
            ),
          },
        };
      }
    default:
      return null;
  }
}

