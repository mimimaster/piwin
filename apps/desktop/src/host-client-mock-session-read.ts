import { isPlaceholderSessionName } from './title-display';
import { createMockSessionTranscriptPage } from './mock-session-transcript-page';
import { createMockSessionTranscriptWindow } from './mock-session-transcript-window';
import { visibleMockTranscript } from './host-client-mock-tree.js';
import { createMockSessionUserMessageIndex } from './mock-session-user-message-index';
import {
  compareMockSessionSummaries,
  formatMockSessionPageCursor,
  mockSessionPageRevision,
  parseMockSessionPageCursor,
} from './host-client-mock-helpers.js';
import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  SessionListData,
  SessionListPageData,
  SessionTranscriptPageData,
  SessionSummary,
} from '@piwin/contracts';
import {
  isRunTerminal,
  SESSION_LIST_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';

export async function handleMockSessionReadCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'session/list': {
        const includeArchived = command.includeArchived === true;
        const listScope = command.scope;
        const listProjectPath = command.projectPath;
        const order = command.order ?? 'updated';
        if (
          command.maxItems !== undefined &&
          (!Number.isSafeInteger(command.maxItems) || command.maxItems <= 0)
        ) {
          return {
            id,
            type: 'response',
            command: 'session/list',
            success: false,
            error: 'Session list maxItems must be a positive safe integer',
          };
        }
        const matchingSessions: SessionSummary[] = [...host.sessions.entries()]
          .map(([sessionId, value]) => {
            const scope =
              value.scope ??
              (value.projectPath
                ? ({ kind: 'project', projectPath: value.projectPath } as const)
                : ({ kind: 'general' } as const));
            const workingDirectory =
              value.workingDirectory ?? (scope.kind === 'project' ? scope.projectPath : 'general');
            const summary: SessionSummary = {
              id: sessionId,
              scope,
              workingDirectory,
              projectPath: value.projectPath,
              updatedAt: value.updatedAt ?? new Date().toISOString(),
              messageCount: value.transcript.length || value.events.length,
            };
            if (value.name) summary.name = value.name;
            if (value.nameSource) summary.nameSource = value.nameSource;
            if (value.isPinned === true) summary.isPinned = true;
            if (value.pinnedAt) summary.pinnedAt = value.pinnedAt;
            if (value.isArchived === true) summary.isArchived = true;
            if (value.archivedAt) summary.archivedAt = value.archivedAt;
            if (value.origin) summary.origin = value.origin;
            return summary;
          })
          .filter((session) => {
            if (isPlaceholderSessionName(session.name)) {
              return false;
            }
            if (command.allScopes !== true) {
              if (listScope?.kind === 'general') {
                if (session.scope.kind !== 'general') return false;
              } else if (listScope?.kind === 'project') {
                if (
                  session.scope.kind !== 'project' ||
                  session.scope.projectPath !== listScope.projectPath
                ) {
                  return false;
                }
              } else if (typeof listProjectPath === 'string') {
                if (session.projectPath !== listProjectPath) return false;
              } else if (session.scope.kind !== 'general') {
                return false;
              }
            }
            if (includeArchived) {
              return true;
            }
            return session.isArchived !== true;
          })
          .sort((left, right) => compareMockSessionSummaries(left, right, order));
        const totalCount = matchingSessions.length;
        const sessions =
          command.maxItems === undefined
            ? matchingSessions
            : matchingSessions.slice(0, command.maxItems);
        const data: SessionListData = {
          sessions,
          totalCount,
          truncated: sessions.length < totalCount,
        };
        return { id, type: 'response', command: 'session/list', success: true, data };
      }
      case 'session/list-page': {
        const query = command.query;
        if (
          !Number.isSafeInteger(query.limit) ||
          query.limit <= 0 ||
          query.limit > SESSION_LIST_PAGE_MAX_ITEMS
        ) {
          return {
            id,
            type: 'response',
            command: 'session/list-page',
            success: false,
            error: `Session list page limit must be between 1 and ${SESSION_LIST_PAGE_MAX_ITEMS}`,
          };
        }

        const sessions = [...host.sessions.entries()]
          .map(([sessionId, session]) => host.mockSessionSummary(sessionId, session))
          .filter((session) => {
            if (isPlaceholderSessionName(session.name)) return false;
            if (query.scope.kind === 'general') {
              if (session.scope.kind !== 'general') return false;
            } else if (
              session.scope.kind !== 'project' ||
              session.scope.projectPath !== query.scope.projectPath
            ) {
              return false;
            }
            return query.lifecycle === 'archived'
              ? session.isArchived === true
              : session.isArchived !== true;
          })
          .sort((left, right) => compareMockSessionSummaries(left, right, query.order));
        const revision = mockSessionPageRevision(
          JSON.stringify({
            scope: query.scope,
            lifecycle: query.lifecycle,
            order: query.order,
            sessions,
          }),
        );
        const cursor = query.cursor === undefined ? null : parseMockSessionPageCursor(query.cursor);
        if (query.cursor !== undefined && cursor === null) {
          return {
            id,
            type: 'response',
            command: 'session/list-page',
            success: false,
            error: 'Session list cursor encoding is invalid',
          };
        }
        if (cursor !== null && cursor.revision !== revision) {
          const stale: SessionListPageData = {
            status: 'stale-cursor',
            currentRevision: revision,
          };
          return {
            id,
            type: 'response',
            command: 'session/list-page',
            success: true,
            data: stale,
          };
        }
        if (cursor !== null && cursor.limit !== query.limit) {
          return {
            id,
            type: 'response',
            command: 'session/list-page',
            success: false,
            error: 'Session list cursor limit does not match the query',
          };
        }

        const anchorIndex =
          cursor === null && query.anchorSessionId !== undefined
            ? sessions.findIndex((session) => session.id === query.anchorSessionId)
            : -1;
        const offset =
          cursor?.offset ??
          (anchorIndex >= 0 ? Math.floor(anchorIndex / query.limit) * query.limit : 0);
        if (offset % query.limit !== 0 || (offset > 0 && offset >= sessions.length)) {
          return {
            id,
            type: 'response',
            command: 'session/list-page',
            success: false,
            error: 'Session list cursor offset is outside the collection',
          };
        }
        const pageSessions = sessions.slice(offset, offset + query.limit);
        const totalCount = sessions.length;
        const pageData: SessionListPageData = {
          status: 'page',
          sessions: pageSessions,
          page: {
            revision,
            pageIndex: totalCount === 0 ? 0 : Math.floor(offset / query.limit),
            pageCount: totalCount === 0 ? 0 : Math.ceil(totalCount / query.limit),
            totalCount,
          },
        };
        if (pageData.status === 'page') {
          if (offset > 0) {
            pageData.page.previousCursor = formatMockSessionPageCursor({
              revision,
              offset: Math.max(0, offset - query.limit),
              limit: query.limit,
            });
          }
          if (offset + pageSessions.length < totalCount) {
            pageData.page.nextCursor = formatMockSessionPageCursor({
              revision,
              offset: offset + query.limit,
              limit: query.limit,
            });
          }
        }
        return {
          id,
          type: 'response',
          command: 'session/list-page',
          success: true,
          data: pageData,
        };
      }
      case 'session/create': {
        const sessionId = crypto.randomUUID();
        const scope =
          command.input.scope ??
          (command.input.projectPath
            ? ({ kind: 'project', projectPath: command.input.projectPath } as const)
            : ({ kind: 'general' } as const));
        const projectPath =
          scope.kind === 'project' ? scope.projectPath : (command.input.projectPath ?? '');
        host.sessions.set(sessionId, {
          projectPath,
          scope,
          workingDirectory: scope.kind === 'project' ? scope.projectPath : 'general',
          events: [],
          transcript: [],
          name: command.input.sessionName ?? '',
          updatedAt: new Date().toISOString(),
          ...(command.input.knowledgeBaseIds && command.input.knowledgeBaseIds.length > 0
            ? { knowledgeBaseIds: [...command.input.knowledgeBaseIds] }
            : {}),
        });
        host.emitPush({ type: 'host/status', mode: host.getMode(), ready: true, mock: true });
        return {
          id,
          type: 'response',
          command: 'session/create',
          success: true,
          data: { sessionId },
        };
      }
      case 'session/resume': {
        let session = host.sessions.get(command.sessionId);
        if (
          session?.storage?.state === 'offloaded' ||
          session?.storage?.state === 'missing-pack'
        ) {
          return {
            id,
            type: 'response',
            command: 'session/resume',
            success: false,
            error:
              session.storage.state === 'missing-pack'
                ? `session-pack-missing: Session "${command.sessionId}" is missing-pack; supply a matching pack before resume`
                : `session-body-offloaded: Session "${command.sessionId}" is offloaded; restore it from its pack before resume`,
          };
        }
        if (!session) {
          session = { projectPath: '/mock/project', events: [], transcript: [] };
          host.sessions.set(command.sessionId, session);
        }
        const transcriptPage = createMockSessionTranscriptPage(visibleMockTranscript(session), {
          sessionId: command.sessionId,
          limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
          maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
        });
        if (transcriptPage.status !== 'page') {
          throw new Error('Mock cursorless transcript tail unexpectedly returned stale');
        }
        const scope =
          session.scope ??
          (session.projectPath
            ? ({ kind: 'project', projectPath: session.projectPath } as const)
            : ({ kind: 'general' } as const));
        const workingDirectory =
          session.workingDirectory ??
          (scope.kind === 'project' ? scope.projectPath : 'general');
        return {
          id,
          type: 'response',
          command: 'session/resume',
          success: true,
          data: {
            sessionId: command.sessionId,
            live: true,
            messages: transcriptPage.messages,
            transcriptPage: transcriptPage.page,
            projectPath: session.projectPath,
            scope,
            workingDirectory,
            ...host.contextTelemetry.resumeFields(command.sessionId),
            ...(session.name ? { name: session.name } : {}),
          },
        };
      }
      case 'session/transcript-page': {
        const session = host.sessions.get(command.query.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/transcript-page',
            success: false,
            error: `Unknown session: ${command.query.sessionId}`,
          };
        }
        let page: SessionTranscriptPageData;
        try {
          page = createMockSessionTranscriptPage(visibleMockTranscript(session), command.query);
        } catch (error) {
          return {
            id,
            type: 'response',
            command: 'session/transcript-page',
            success: false,
            error: error instanceof Error ? error.message : 'Invalid transcript page request',
          };
        }
        return {
          id,
          type: 'response',
          command: 'session/transcript-page',
          success: true,
          data: page,
        };
      }
      case 'session/user-message-index': {
        const session = host.sessions.get(command.query.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/user-message-index',
            success: false,
            error: `Unknown session: ${command.query.sessionId}`,
          };
        }
        try {
          const index = createMockSessionUserMessageIndex(visibleMockTranscript(session), command.query);
          return {
            id,
            type: 'response',
            command: 'session/user-message-index',
            success: true,
            data: index,
          };
        } catch (error) {
          return {
            id,
            type: 'response',
            command: 'session/user-message-index',
            success: false,
            error: error instanceof Error ? error.message : 'Invalid user-message index request',
          };
        }
      }
      case 'session/transcript-window': {
        const session = host.sessions.get(command.query.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/transcript-window',
            success: false,
            error: `Unknown session: ${command.query.sessionId}`,
          };
        }
        try {
          const window = createMockSessionTranscriptWindow(visibleMockTranscript(session), command.query);
          return {
            id,
            type: 'response',
            command: 'session/transcript-window',
            success: true,
            data: window,
          };
        } catch (error) {
          return {
            id,
            type: 'response',
            command: 'session/transcript-window',
            success: false,
            error: error instanceof Error ? error.message : 'Invalid transcript window request',
          };
        }
      }
      case 'session/messages': {
        const session = host.sessions.get(command.sessionId);
        return {
          id,
          type: 'response',
          command: 'session/messages',
          success: true,
          data: {
            sessionId: command.sessionId,
            messages: session ? visibleMockTranscript(session) : [],
          },
        };
      }
      case 'session/foreground-run': {
        const activeRunId = host.mockActiveRunIds.get(command.sessionId);
        const activeRun = activeRunId ? host.mockRuns.get(activeRunId) : undefined;
        return {
          id,
          type: 'response',
          command: 'session/foreground-run',
          success: true,
          data: {
            sessionId: command.sessionId,
            run: activeRun && !isRunTerminal(activeRun.status) ? activeRun : null,
          },
        };
      }
      case 'session/export': {
        const session = host.sessions.get(command.sessionId);
        const messages = session?.transcript ?? [];
        const format = command.format === 'html' ? 'html' : 'md';
        const redactTools = command.redactTools === true;
        const lines: string[] = [];
        if (format === 'html') {
          lines.push('<!DOCTYPE html><html><body><h1>Mock export</h1>');
          for (const message of messages) {
            lines.push(`<p><strong>${message.role}</strong></p><pre>${message.text}</pre>`);
            if (message.tools) {
              for (const tool of message.tools) {
                const output = redactTools ? '[tool output redacted]' : tool.output;
                lines.push(`<pre>${tool.toolName}: ${output}</pre>`);
              }
            }
          }
          lines.push('</body></html>');
        } else {
          lines.push('# Mock session export');
          lines.push('');
          for (const message of messages) {
            lines.push(`### ${message.role}`);
            lines.push('');
            lines.push(message.text);
            lines.push('');
            if (message.tools) {
              for (const tool of message.tools) {
                const output = redactTools ? '[tool output redacted]' : tool.output;
                lines.push(`##### ${tool.toolName}`);
                lines.push('```');
                lines.push(output);
                lines.push('```');
                lines.push('');
              }
            }
          }
        }
        const content = lines.join('\n');
        if (command.destination === 'content') {
          return {
            id,
            type: 'response',
            command: 'session/export',
            success: true,
            data: {
              sessionId: command.sessionId,
              format,
              redactTools,
              content,
              byteLength: content.length,
            },
          };
        }
        const path =
          command.outputPath?.trim() ||
          `/mock/exports/piwin-export-${command.sessionId.slice(0, 8)}.${format === 'html' ? 'html' : 'md'}`;
        return {
          id,
          type: 'response',
          command: 'session/export',
          success: true,
          data: {
            sessionId: command.sessionId,
            format,
            redactTools,
            path,
            byteLength: content.length,
          },
        };
      }
      case 'session/tool-output': {
        const session = host.sessions.get(command.sessionId);
        const message = session?.transcript.find((item) => item.id === command.messageId);
        const tool = message?.tools?.find((item) => item.toolCallId === command.toolCallId);
        if (!message || !tool) {
          return {
            id,
            type: 'response',
            command: 'session/tool-output',
            success: true,
            data: { status: 'unavailable', reason: 'not-found' },
          };
        }
        // Same precedence as the Host snapshot reader (@piwin/session).
        const output = tool.presentation?.output?.text ?? (tool.output || '');
        if (!output.trim()) {
          return {
            id,
            type: 'response',
            command: 'session/tool-output',
            success: true,
            data: { status: 'unavailable', reason: 'snapshot-unavailable' },
          };
        }
        return {
          id,
          type: 'response',
          command: 'session/tool-output',
          success: true,
          data: {
            status: 'ready',
            output,
            truncated: false,
            redacted: false,
            provenance: 'tool-snapshot',
          },
        };
      }
    default:
      return null;
  }
}

