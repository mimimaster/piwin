import { isPlaceholderSessionName } from './title-display';
import { deriveDefaultNameFromMessage } from '@piwin/session/derive-default-name';
import { buildForkSessionName } from '@piwin/session/fork-session-name';
import { createMockSessionTranscriptPage } from './mock-session-transcript-page';
import { createMockSessionTranscriptWindow } from './mock-session-transcript-window';
import {
  appendMockTranscriptMessage,
  applyMockRetryPrompt,
  ensureMockTree,
  listMockBranchPoints,
  mockOffPathWrites,
  rebaseMockLeaf,
  switchMockBranch,
  truncateMockSubtree,
  visibleMockTranscript,
} from './host-client-mock-tree.js';
import { createMockSessionUserMessageIndex } from './mock-session-user-message-index';
import {
  PIWIN_APPEARANCE_BONE,
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_OBSIDIAN,
  migrateThemeId,
} from './appearance-tokens';
/** Browser mock host backend — isolated from live Tauri transport. */
import type {
  AgentEvent,
  ExecutionRunRecord,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  MediaAttachmentRef,
  ModelRef,
  ProductSessionLineageView,
  ProductSessionOrigin,
  PromptInput,
  SessionListData,
  SessionListPageData,
  SessionTranscriptPageData,
  SessionSummary,
  SessionTranscriptMessage,
  SearchRoutePreviewData,
  UsageBucket,
  UsageRollup,
  WalkthroughArtifact,
  ContextSummaryPush,
  RunInterventionRecord,
  QueuedTurnRecord,
  ThemeManifest,
} from '@piwin/contracts';
import {
  isJobTerminal,
  isRunTerminal,
  estimateHostTokens,
  QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION,
  QUEUED_TURN_MAX_PENDING_PER_SESSION,
  QUEUED_TURN_MAX_TEXT_BYTES,
  SESSION_LIST_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';

export type MockEmit = (message: HostPush) => void;

type MockBuiltinThemeId = 'piwin-obsidian' | 'piwin-bone' | 'piwin-ink-wash';

function resolveMockThemeId(themeId: string): MockBuiltinThemeId {
  const migrated = migrateThemeId(themeId);
  if (migrated === 'piwin-bone' || migrated === 'piwin-ink-wash') {
    return migrated;
  }
  return 'piwin-obsidian';
}

function mockThemeManifest(themeId: MockBuiltinThemeId): ThemeManifest {
  switch (themeId) {
    case 'piwin-bone':
      return PIWIN_APPEARANCE_BONE;
    case 'piwin-ink-wash':
      return PIWIN_APPEARANCE_INK_WASH;
    default:
      return PIWIN_APPEARANCE_OBSIDIAN;
  }
}

/**
 * In-process deterministic host for Vite/browser e2e.
 * Owns mock session/transcript/MCP state only.
 */
export class MockHostBackend {
  private readonly emitPush: MockEmit;
  private readonly getMode: () => HostMode;

  private sessions = new Map<
    string,
    {
      projectPath: string;
      scope?: import('@piwin/contracts').SessionScope;
      workingDirectory?: string;
      events: AgentEvent[];
      transcript: SessionTranscriptMessage[];
      parentById?: Record<string, string | null>;
      activeLeafMessageId?: string | null;
      name?: string;
      nameSource?: 'default' | 'text' | 'llm' | 'user';
      updatedAt?: string;
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
      origin?: ProductSessionOrigin;
      storage?: import('@piwin/contracts').SessionStorageInfo;
    }
  >();
  private plans = new Map<string, import('@piwin/contracts').SessionPlan>();
  private childIndex = new Map<string, import('@piwin/contracts').SessionSummary[]>();
  /** Mock-only: extension ids disabled via extensions/set_enabled. */
  private mockDisabledExtensionIds = new Set<string>();
  private mockBundledExtensionsInstalled = true;
  private mockDisabledPromptIds = new Set<string>();
  private mockActiveThemeId: 'piwin-obsidian' | 'piwin-bone' | 'piwin-ink-wash' =
    'piwin-obsidian';
  private mockJobs = new Map<string, import('@piwin/contracts').JobRecord>();
  private mockJobLogs = new Map<string, string>();
  private mockPtys = new Map<string, { projectPath: string }>();
  private mockRememberedPermissions = new Map<
    string,
    Array<{ key: string; action: string; detail: string }>
  >();
  private mockProjects = new Map<string, import('@piwin/contracts').ProjectRecord>();
  private mockCronJobs: import('@piwin/contracts').CronJob[] = [];
  private mockHooks: import('@piwin/contracts').HookDefinition[] = [];
  private mockMcpDocument: import('@piwin/contracts').McpConfigDocument = { mcpServers: {} };
  /** In-flight mock prompt cancellation per session. */
  private mockPromptAborts = new Map<string, AbortController>();
  /** In-memory equivalent of the Host's durable active pause checkpoint. */
  private mockPauseCheckpointIds = new Map<string, string>();
  private mockRunInterventions = new Map<string, RunInterventionRecord>();
  private mockQueuedTurns = new Map<string, QueuedTurnRecord[]>();
  private mockQueueRevisions = new Map<string, number>();
  private mockPauseRequested = new Set<string>();
  /** Mock browser session current URL (null = stopped). */
  private mockMediaUploads = new Map<
    string,
    { sessionId: string; mimeType: string; name?: string; byteSize: number }
  >();
  private mockBrowserUrl: string | null = null;
  private mockBrowserAgentWantsLock = false;
  /** ADR 0015: the run currently owning each session's foreground turn. */
  private mockActiveRunIds = new Map<string, string>();
  private mockAssemblySummaries = new Map<string, ContextSummaryPush[]>();
  private mockAssemblyOrdinals = new Map<string, number>();
  /** Guards the exactly-once terminal transition for each mock run. */
  private mockTerminalRunIds = new Set<string>();
  private mockRuns = new Map<string, ExecutionRunRecord>();
  private mockConfig: import('@piwin/contracts').PiwinConfig = {
    hostMode: 'sdk',
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100 * 1024,
    },
  };
  /** Monotonic revision for the in-memory settings snapshot (mock parity). */
  private mockSettingsRevision = 'mock-settings-v1';
  /** Runtime-only revision kept separate from the full settings CAS token. */
  private mockRuntimeSettingsRevision = 'mock-runtime-settings-v1';
  private mockUserPermissionRules: import('@piwin/contracts').PermissionRulesFile = { version: 1 };
  private mockUserPermissionRulesRevision = 'mock-rules-empty';
  private readonly e2eCommandCounts = {
    sessionList: 0,
    sessionListPage: 0,
  };

  constructor(emitPush: MockEmit, getMode: () => HostMode) {
    this.emitPush = emitPush;
    this.getMode = getMode;
    this.installE2eHarness();
  }

  clear(): void {
    this.sessions.clear();
    this.plans.clear();
    this.childIndex.clear();
    this.mockJobs.clear();
    this.mockJobLogs.clear();
    this.mockPtys.clear();
    this.mockRememberedPermissions.clear();
    this.mockPromptAborts.clear();
    this.mockPauseCheckpointIds.clear();
    this.mockPauseRequested.clear();
    this.mockQueuedTurns.clear();
    this.mockQueueRevisions.clear();
    this.mockActiveRunIds.clear();
    this.mockTerminalRunIds.clear();
  }

  /** Playwright-only seed + request counters. Off unless the page query asks. */
  private installE2eHarness(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const seedCount = Number(params.get('e2eSeedSessions'));
    if (Number.isSafeInteger(seedCount) && seedCount > 0) {
      const now = Date.parse('2026-08-13T00:00:00.000Z');
      for (let index = 0; index < seedCount; index += 1) {
        const sessionId = `e2e-session-${index + 1}`;
        this.sessions.set(sessionId, {
          projectPath: '',
          scope: { kind: 'general' },
          workingDirectory: 'general',
          events: [],
          transcript: [],
          name: `E2E Session ${String(index + 1).padStart(3, '0')}`,
          nameSource: 'user',
          updatedAt: new Date(now - index * 60_000).toISOString(),
        });
      }
    }
    if (params.get('e2eHostDiagnostics') === '1') {
      (
        window as Window & {
          __PIWIN_E2E_HOST_STATS__?: { sessionList: number; sessionListPage: number };
        }
      ).__PIWIN_E2E_HOST_STATS__ = this.e2eCommandCounts;
    }
  }

  private mockSessionSummary(
    sessionId: string,
    session: {
      projectPath: string;
      scope?: import('@piwin/contracts').SessionScope;
      workingDirectory?: string;
      events: AgentEvent[];
      transcript: SessionTranscriptMessage[];
      parentById?: Record<string, string | null>;
      activeLeafMessageId?: string | null;
      name?: string;
      nameSource?: 'default' | 'text' | 'llm' | 'user';
      updatedAt?: string;
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
      origin?: ProductSessionOrigin;
      storage?: import('@piwin/contracts').SessionStorageInfo;
    },
  ): SessionSummary {
    const scope =
      session.scope ??
      (session.projectPath
        ? ({ kind: 'project', projectPath: session.projectPath } as const)
        : ({ kind: 'general' } as const));
    const workingDirectory =
      session.workingDirectory ?? (scope.kind === 'project' ? scope.projectPath : 'general');
    const summary: SessionSummary = {
      id: sessionId,
      scope,
      workingDirectory,
      projectPath: session.projectPath,
      updatedAt: session.updatedAt ?? '1970-01-01T00:00:00.000Z',
      messageCount: visibleMockTranscript(session).length || session.events.length,
      name: session.name ?? `session-${sessionId.slice(0, 8)}`,
    };
    if (session.nameSource) summary.nameSource = session.nameSource;
    if (session.isPinned === true) summary.isPinned = true;
    if (session.pinnedAt) summary.pinnedAt = session.pinnedAt;
    if (session.isArchived === true) summary.isArchived = true;
    if (session.archivedAt) summary.archivedAt = session.archivedAt;
    if (session.origin) summary.origin = session.origin;
    if (session.storage && session.storage.state !== 'local') summary.storage = session.storage;
    return summary;
  }

  private mockResolveLineageRoot(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    return session?.origin?.kind === 'fork' ? session.origin.rootSessionId : sessionId;
  }

  private mockGetDirectForkNames(sourceSessionId: string): string[] {
    return [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.origin?.kind === 'fork' && candidate.origin.sourceSessionId === sourceSessionId,
      )
      .map((candidate) => candidate.name ?? '')
      .filter((name) => name.length > 0);
  }

  private mockBuildSessionLineage(sessionId: string): ProductSessionLineageView {
    const targetSession = this.sessions.get(sessionId);
    const rootSessionId =
      targetSession?.origin?.kind === 'fork' ? targetSession.origin.rootSessionId : sessionId;
    const nodes = [...this.sessions.entries()]
      .filter(([candidateId]) => this.mockResolveLineageRoot(candidateId) === rootSessionId)
      .map(([candidateId, candidate]) => ({
        sessionId: candidateId,
        ...(candidate.name ? { name: candidate.name } : {}),
        ...(candidate.origin ? { origin: candidate.origin } : {}),
        isArchived: candidate.isArchived === true,
        updatedAt: new Date().toISOString(),
      }));
    nodes.sort((left, right) => {
      if (left.sessionId === rootSessionId) return -1;
      if (right.sessionId === rootSessionId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    return {
      rootSessionId,
      activeSessionId: sessionId,
      rootMissing: !this.sessions.has(rootSessionId),
      nodes,
    };
  }

  async handle(command: HostCommand, id: string): Promise<HostResponse> {
    if (command.type === 'session/list') {
      this.e2eCommandCounts.sessionList += 1;
    } else if (command.type === 'session/list-page') {
      this.e2eCommandCounts.sessionListPage += 1;
    }
    switch (command.type) {
      case 'host/ping':
        return { id, type: 'response', command: 'host/ping', success: true, data: { pong: true } };
      case 'host/status':
        return {
          id,
          type: 'response',
          command: 'host/status',
          success: true,
          data: {
            mode: this.getMode(),
            ready: true,
            mock: true,
            piwinRoot: '~/.piwin',
            generalWorkspacePath: '~/.piwin/workspace',
            activeSessionIds: [...this.sessions.keys()],
            capabilities: {
              customTools: true,
              mcpLifecycle: true,
              productTranscript: true,
              compaction: true,
              extensions: true,
              prompts: true,
              process: true,
              sessionSearch: true,
              sessionPin: true,
              sessionLifecycle: true,
              sessionPause: true,
              runInterventions: true,
              queuedTurns: true,
              sessionUserMessageIndex: true,
              sessionTranscriptSeek: true,
              sessionExport: true,
              usage: true,
              pty: false,
              subagentWorktree: true,
              marketplaceHub: true,
              automation: true,
            },
          },
        };
      case 'usage/get-rollup':
        return {
          id,
          type: 'response',
          command: 'usage/get-rollup',
          success: true,
          data: { rollup: createMockUsageRollup(command.projectPath) },
        };
      case 'project/open': {
        const openedAt = new Date().toISOString();
        const existingProject = this.mockProjects.get(command.path);
        this.mockProjects.set(command.path, {
          path: command.path,
          trust: existingProject?.trust ?? 'untrusted',
          lastOpenedAt: openedAt,
          createdAt: existingProject?.createdAt ?? openedAt,
        });
        if (!this.mockRememberedPermissions.has(command.path)) {
          this.mockRememberedPermissions.set(command.path, [
            {
              key: 'network:web_search',
              action: 'network:web_search',
              detail: 'Web search allowed for this project',
            },
          ]);
        }
        // Report the persisted trust state: re-opening an already-trusted
        // project must not demote it to untrusted (mirrors host behavior).
        const trustState = this.mockProjects.get(command.path)?.trust ?? 'untrusted';
        return {
          id,
          type: 'response',
          command: 'project/open',
          success: true,
          data: {
            path: command.path,
            trusted: trustState === 'trusted',
            trust: trustState,
          },
        };
      }
      case 'project/list':
        return {
          id,
          type: 'response',
          command: 'project/list',
          success: true,
          data: {
            projects: [...this.mockProjects.values()].sort((left, right) =>
              right.lastOpenedAt.localeCompare(left.lastOpenedAt),
            ),
          },
        };
      case 'project/remove': {
        const removed = this.mockProjects.delete(command.path);
        this.mockRememberedPermissions.delete(command.path);
        if (removed) {
          return {
            id,
            type: 'response',
            command: 'project/remove',
            success: true,
            data: { path: command.path, removed: true },
          };
        }
        return {
          id,
          type: 'response',
          command: 'project/remove',
          success: false,
          error: `Project not found: ${command.path}`,
        };
      }
      case 'project/trust':
        {
          const existingProject = this.mockProjects.get(command.path);
          if (existingProject) {
            this.mockProjects.set(command.path, { ...existingProject, trust: 'trusted' });
          }
        }
        return {
          id,
          type: 'response',
          command: 'project/trust',
          success: true,
          data: { path: command.path, trusted: true, trust: 'trusted' },
        };
      case 'project/permissions-list': {
        const pathKey = command.path;
        const perms = this.mockRememberedPermissions.get(pathKey) ?? [];
        return {
          id,
          type: 'response',
          command: 'project/permissions-list',
          success: true,
          data: { projectPath: pathKey, permissions: [...perms] },
        };
      }
      case 'project/permissions-revoke': {
        const pathKey = command.path;
        const key = command.key;
        const current = this.mockRememberedPermissions.get(pathKey) ?? [];
        const next = current.filter((item) => item.key !== key);
        this.mockRememberedPermissions.set(pathKey, next);
        return {
          id,
          type: 'response',
          command: 'project/permissions-revoke',
          success: true,
          data: { projectPath: pathKey, key, ok: true, permissions: next },
        };
      }
      case 'project/list-dir': {
        const relativePath = (command.relativePath ?? '').replace(/^\/+|\/+$/g, '');
        const baseName = command.projectPath.split('/').filter(Boolean).pop() ?? 'project';
        const entries =
          relativePath === ''
            ? [
                {
                  name: 'README.md',
                  relativePath: 'README.md',
                  kind: 'file' as const,
                  sizeBytes: 1200,
                },
                { name: 'src', relativePath: 'src', kind: 'directory' as const },
                {
                  name: 'package.json',
                  relativePath: 'package.json',
                  kind: 'file' as const,
                  sizeBytes: 800,
                },
              ]
            : relativePath === 'src'
              ? [
                  {
                    name: 'index.ts',
                    relativePath: 'src/index.ts',
                    kind: 'file' as const,
                    sizeBytes: 240,
                  },
                ]
              : [];
        return {
          id,
          type: 'response',
          command: 'project/list-dir',
          success: true,
          data: {
            projectPath: command.projectPath,
            relativePath,
            entries,
            mockWorkspace: baseName,
          },
        };
      }
      case 'project/read-file': {
        const relativePath = (command.relativePath ?? '').replace(/^\/+|\/+$/g, '');
        const absolutePath = `${command.projectPath.replace(/\/+$/, '')}/${relativePath}`;
        const lowerName = relativePath.toLowerCase();
        if (/\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/.test(lowerName)) {
          const mimeHint = lowerName.endsWith('.svg')
            ? 'image/svg+xml'
            : lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')
              ? 'image/jpeg'
              : lowerName.endsWith('.gif')
                ? 'image/gif'
                : lowerName.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/png';
          // 1×1 transparent PNG — enough for the file-tree image stage to mount.
          const previewDataUrl =
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
          return {
            id,
            type: 'response',
            command: 'project/read-file',
            success: true,
            data: {
              projectPath: command.projectPath,
              relativePath,
              absolutePath,
              content: '',
              byteSize: 68,
              truncated: false,
              isBinary: !lowerName.endsWith('.svg'),
              mimeHint,
              previewDataUrl,
            },
          };
        }
        const content = [
          `// mock preview of ${relativePath}`,
          'export function hello() {',
          "  return 'piwin';",
          '}',
          '',
        ].join('\n');
        return {
          id,
          type: 'response',
          command: 'project/read-file',
          success: true,
          data: {
            projectPath: command.projectPath,
            relativePath,
            absolutePath,
            content,
            byteSize: content.length,
            truncated: false,
            isBinary: false,
            mimeHint: 'text/plain',
          },
        };
      }
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
        const matchingSessions: SessionSummary[] = [...this.sessions.entries()]
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

        const sessions = [...this.sessions.entries()]
          .map(([sessionId, session]) => this.mockSessionSummary(sessionId, session))
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
        this.sessions.set(sessionId, {
          projectPath,
          scope,
          workingDirectory: scope.kind === 'project' ? scope.projectPath : 'general',
          events: [],
          transcript: [],
          name: command.input.sessionName ?? '',
          updatedAt: new Date().toISOString(),
        });
        this.emitPush({ type: 'host/status', mode: this.getMode(), ready: true, mock: true });
        return {
          id,
          type: 'response',
          command: 'session/create',
          success: true,
          data: { sessionId },
        };
      }
      case 'session/resume': {
        let session = this.sessions.get(command.sessionId);
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
          this.sessions.set(command.sessionId, session);
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
            ...(session.name ? { name: session.name } : {}),
          },
        };
      }
      case 'session/transcript-page': {
        const session = this.sessions.get(command.query.sessionId);
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
        const session = this.sessions.get(command.query.sessionId);
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
        const session = this.sessions.get(command.query.sessionId);
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
        const session = this.sessions.get(command.sessionId);
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
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        const activeRun = activeRunId ? this.mockRuns.get(activeRunId) : undefined;
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
        const session = this.sessions.get(command.sessionId);
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
        const session = this.sessions.get(command.sessionId);
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
        const output = tool.output || '';
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
      case 'session/queued-turn-submit':
        return this.handleMockQueuedTurnSubmit(command, id);
      case 'session/queued-turn-list':
        return this.handleMockQueuedTurnList(command, id);
      case 'session/queued-turn-edit':
        return this.handleMockQueuedTurnEdit(command, id);
      case 'session/queued-turn-cancel':
        return this.handleMockQueuedTurnCancel(command, id);
      case 'session/queued-turn-reorder':
        return this.handleMockQueuedTurnReorder(command, id);
      case 'session/replace-run':
        return this.handleMockReplaceRun(command, id);
      case 'session/prompt': {
        const session = this.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: `unknown session ${command.sessionId}`,
          };
        }
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: `run-active: session ${command.sessionId} already has foreground run`,
          };
        }
        if (
          command.input.source === 'resume' &&
          command.input.resumeCheckpointId !== this.mockPauseCheckpointIds.get(command.sessionId)
        ) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: 'resume-checkpoint-mismatch',
          };
        }
        const now = new Date().toISOString();
        const runId = crypto.randomUUID();
        this.mockActiveRunIds.set(command.sessionId, runId);
        this.pushMockRunUpdated(
          command.sessionId,
          runId,
          'running',
          'accepted',
          now,
          command.input.resumeCheckpointId,
        );
        this.pushMockRunUpdated(command.sessionId, runId, 'running', 'preparing');
        const clientMessageId = command.input.clientMessageId?.trim();
        const userMessage: SessionTranscriptMessage = {
          id: clientMessageId && clientMessageId.length > 0 ? clientMessageId : crypto.randomUUID(),
          role: 'user',
          text: command.input.text,
          createdAt: now,
          status: 'done',
        };
        if (command.input.attachments && command.input.attachments.length > 0) {
          const mediaAttachments = command.input.attachments.filter(
            (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
          );
          if (mediaAttachments.length > 0) {
            userMessage.attachments = mediaAttachments;
          }
        }
        if (
          command.input.branchFromMessageId !== undefined &&
          command.input.retryUserMessageId !== undefined
        ) {
          return {
            id,
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: 'retry-and-branch-conflict',
          };
        }
        let retryUser: SessionTranscriptMessage | undefined;
        if (command.input.retryUserMessageId !== undefined) {
          const retried = applyMockRetryPrompt(session, {
            retryUserMessageId: command.input.retryUserMessageId,
            keepPrevious: command.input.keepPreviousAttempt === true,
            confirm: command.confirm === true,
          });
          if (!retried.ok) {
            return {
              id,
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: retried.error,
              ...(retried.writes
                ? { problem: { code: 'retry-discards-writes', data: retried.writes } }
                : {}),
            };
          }
          retryUser = retried.user;
          this.emitPush({
            type: 'session/branch-updated',
            sessionId: command.sessionId,
            activeLeafMessageId: session.activeLeafMessageId ?? null,
            branchPointCount: listMockBranchPoints(session).length,
          });
        } else if (command.input.branchFromMessageId !== undefined) {
          const target = session.transcript.find(
            (message) => message.id === command.input.branchFromMessageId,
          );
          if (target === undefined) {
            return {
              id,
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: `branch-target-not-found: ${command.input.branchFromMessageId}`,
            };
          }
          if (target.role !== 'user') {
            return {
              id,
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: `branch-target-not-user: ${command.input.branchFromMessageId}`,
            };
          }
          ensureMockTree(session);
          rebaseMockLeaf(session, session.parentById?.[target.id] ?? null);
          this.emitPush({
            type: 'session/branch-updated',
            sessionId: command.sessionId,
            activeLeafMessageId: session.activeLeafMessageId ?? null,
            branchPointCount: listMockBranchPoints(session).length,
          });
        }
        if (
          retryUser === undefined &&
          command.input.source !== 'resume' &&
          command.input.source !== 'queued-turn'
        ) {
          appendMockTranscriptMessage(session, userMessage);
        }
        // Immediate text name (matches host recordUserPrompt naming pipeline).
        this.maybeMockAutoName(command.sessionId);
        const attachmentNote =
          command.input.attachments && command.input.attachments.length > 0
            ? `\n[attachments: ${command.input.attachments
                .filter((item): item is MediaAttachmentRef => item.kind === 'media')
                .map((item) => item.path)
                .join(', ')}]`
            : '';
        const promptText = retryUser?.text ?? command.input.text;
        this.emitMockAssemblySummary({
          sessionId: command.sessionId,
          runId,
          requestClass: command.input.source === 'resume' ? 'pause-resume' : 'prompt',
          ...(command.input.source === 'resume'
            ? {}
            : { userMessageId: retryUser?.id ?? userMessage.id }),
          text: promptText,
          ...(command.input.attachments ? { attachments: command.input.attachments } : {}),
        });
        // Stream asynchronously so concurrent session/abort can cancel mid-turn.
        void this.emitMockPrompt(
          command.sessionId,
          `${promptText}${attachmentNote}`,
          runId,
        );
        return {
          id,
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId,
            acceptedAt: now,
          },
        };
      }
      case 'session/pause': {
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        const existingCheckpoint = this.mockPauseCheckpointIds.get(command.sessionId);
        if (!activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/pause',
            success: true,
            data: {
              sessionId: command.sessionId,
              state: existingCheckpoint ? 'paused' : 'paused',
              ...(existingCheckpoint ? { checkpointId: existingCheckpoint } : {}),
              ...(!existingCheckpoint ? { reason: 'no-active-run' } : {}),
            },
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/pause',
            success: true,
            data: {
              sessionId: command.sessionId,
              runId: activeRunId,
              state: 'pausing',
              reason: 'run-mismatch',
            },
          };
        }
        const checkpointId = existingCheckpoint ?? crypto.randomUUID();
        this.mockPauseCheckpointIds.set(command.sessionId, checkpointId);
        this.mockPauseRequested.add(command.sessionId);
        this.pushMockRunUpdated(command.sessionId, activeRunId, 'cancelling', 'pausing');
        this.mockPromptAborts.get(command.sessionId)?.abort({ code: 'pause-requested' });
        return {
          id,
          type: 'response',
          command: 'session/pause',
          success: true,
          data: { sessionId: command.sessionId, runId: activeRunId, state: 'pausing' },
        };
      }
      case 'session/resume-run': {
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: `run-active: session ${command.sessionId} already has foreground run`,
          };
        }
        const checkpointId =
          command.checkpointId ?? this.mockPauseCheckpointIds.get(command.sessionId);
        if (
          checkpointId === undefined ||
          checkpointId !== this.mockPauseCheckpointIds.get(command.sessionId)
        ) {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: 'no-active-checkpoint',
          };
        }
        const response = await this.handle(
          {
            type: 'session/prompt',
            sessionId: command.sessionId,
            input: {
              text: 'Continue the interrupted task from the current transcript and tool state. Inspect completed work before continuing.',
              source: 'resume',
              resumeCheckpointId: checkpointId,
            },
          },
          id,
        );
        if (!response.success) {
          return { ...response, command: 'session/resume-run' };
        }
        const data = response.data as { runId?: string; acceptedAt?: string } | undefined;
        if (typeof data?.runId !== 'string' || typeof data.acceptedAt !== 'string') {
          return {
            id,
            type: 'response',
            command: 'session/resume-run',
            success: false,
            error: 'resume prompt acknowledgement was invalid',
          };
        }
        return {
          id,
          type: 'response',
          command: 'session/resume-run',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId: data.runId,
            checkpointId,
            acceptedAt: data.acceptedAt,
          },
        };
      }
      case 'session/abort': {
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (!activeRunId) {
          this.mockPauseCheckpointIds.delete(command.sessionId);
          this.mockPauseRequested.delete(command.sessionId);
          return {
            id,
            type: 'response',
            command: 'session/abort',
            success: true,
            data: {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'no-active-run',
            },
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/abort',
            success: true,
            data: {
              sessionId: command.sessionId,
              cancelled: false,
              reason: 'run-mismatch',
              activeRunId,
            },
          };
        }
        this.mockPauseRequested.delete(command.sessionId);
        this.mockPauseCheckpointIds.delete(command.sessionId);
        this.pushMockRunUpdated(command.sessionId, activeRunId, 'cancelling', 'cancelling');
        this.mockPromptAborts.get(command.sessionId)?.abort();
        return {
          id,
          type: 'response',
          command: 'session/abort',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId: activeRunId,
            cancelled: true,
          },
        };
      }

      case 'session/steer': {
        const session = this.sessions.get(command.sessionId);
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (!session || !activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/steer',
            success: false,
            error: `no-active-run: session ${command.sessionId} has no foreground run`,
          };
        }
        if (command.runId !== undefined && command.runId !== activeRunId) {
          return {
            id,
            type: 'response',
            command: 'session/steer',
            success: false,
            error: `run-mismatch: requested ${command.runId}, active ${activeRunId}`,
          };
        }
        const now = new Date().toISOString();
        const userMessageId = command.clientMessageId?.trim() || crypto.randomUUID();
        appendMockTranscriptMessage(session, {
          id: userMessageId,
          role: 'user',
          text: command.message,
          createdAt: now,
          status: 'done',
        });
        this.emitMockAssemblySummary({
          sessionId: command.sessionId,
          runId: activeRunId,
          requestClass: 'steer',
          userMessageId,
          text: command.message,
        });
        return {
          id,
          type: 'response',
          command: 'session/steer',
          success: true,
          data: { sessionId: command.sessionId, runId: activeRunId },
        };
      }

      case 'run/intervention-submit': {
        const session = this.sessions.get(command.sessionId);
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (!session || activeRunId !== command.runId) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: activeRunId
              ? `run-mismatch: requested ${command.runId}, active ${activeRunId}`
              : `no-active-run: session ${command.sessionId} has no foreground run`,
          };
        }
        const replay = this.mockRunInterventions.get(command.interventionId);
        if (replay) {
          const adopted = command.adoptQueuedTurn
            ? this.mockQueuedTurns
                .get(command.sessionId)
                ?.find(
                  (item) =>
                    item.queuedTurnId === command.adoptQueuedTurn?.queuedTurnId &&
                    item.status === 'cancelled' &&
                    item.terminalReason === 'converted-to-intervention',
                )
            : undefined;
          return {
            id,
            type: 'response',
            command: command.type,
            success: true,
            ...(adopted ? { data: { intervention: replay, queuedTurn: adopted } } : { data: { intervention: replay } }),
          };
        }
        const now = new Date().toISOString();
        // Adoption converts a pending queued turn in place: cancel the queue
        // record and re-bind its already-painted user row instead of appending.
        let adoptedQueuedTurn: QueuedTurnRecord | undefined;
        if (command.adoptQueuedTurn) {
          const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
          const target = queue.find(
            (item) => item.queuedTurnId === command.adoptQueuedTurn?.queuedTurnId,
          );
          if (
            !target ||
            target.sessionId !== command.sessionId ||
            target.userMessageId !== command.userMessageId ||
            target.input.text !== command.input.text
          ) {
            return {
              id,
              type: 'response',
              command: command.type,
              success: false,
              error: 'queued-turn-not-found',
            };
          }
          if (target.status !== 'pending' || target.revision !== command.adoptQueuedTurn.expectedRevision) {
            return {
              id,
              type: 'response',
              command: command.type,
              success: false,
              error: 'queued-turn-revision-conflict',
            };
          }
          adoptedQueuedTurn = {
            ...target,
            revision: target.revision + 1,
            status: 'cancelled',
            terminalReason: 'converted-to-intervention',
            updatedAt: now,
          };
          this.mockQueuedTurns.set(
            command.sessionId,
            queue.map((item) => (item.queuedTurnId === adoptedQueuedTurn?.queuedTurnId ? adoptedQueuedTurn : item)),
          );
          this.emitPush({
            type: 'session/queued-turn-updated',
            queuedTurn: adoptedQueuedTurn,
          });
        }
        const intervention: RunInterventionRecord = {
          interventionId: command.interventionId,
          revision: 1,
          sessionId: command.sessionId,
          runId: command.runId,
          runtimeGenerationId: 'mock-generation',
          sequence:
            [...this.mockRunInterventions.values()].filter(
              (item) => item.runId === command.runId,
            ).length + 1,
          userMessageId: command.userMessageId,
          status: 'pending',
          input: command.input,
          submittedAt: now,
          updatedAt: now,
        };
        this.mockRunInterventions.set(intervention.interventionId, intervention);
        if (!adoptedQueuedTurn) {
          const message: SessionTranscriptMessage = {
            id: intervention.userMessageId,
            role: 'user',
            text: intervention.input.text,
            createdAt: now,
            status: 'done',
            runId: intervention.runId,
            instructionDelivery: {
              kind: 'run-intervention',
              instructionId: intervention.interventionId,
              status: intervention.status,
              targetRunId: intervention.runId,
              revision: intervention.revision,
            },
          };
          appendMockTranscriptMessage(session, message);
          this.emitPush({ type: 'transcript/append', sessionId: command.sessionId, message });
        }
        this.emitPush({ type: 'run/intervention-updated', intervention });
        globalThis.setTimeout(() => {
          const current = this.mockRunInterventions.get(intervention.interventionId);
          if (!current || current.status !== 'pending') return;
          if (this.mockActiveRunIds.get(command.sessionId) !== command.runId) {
            const expired: RunInterventionRecord = {
              ...current,
              revision: current.revision + 1,
              status: 'expired',
              updatedAt: new Date().toISOString(),
              terminalReason: 'run-ended',
            };
            this.mockRunInterventions.set(expired.interventionId, expired);
            this.emitPush({ type: 'run/intervention-updated', intervention: expired });
            return;
          }
          const applied: RunInterventionRecord = {
            ...current,
            revision: current.revision + 2,
            status: 'applied',
            updatedAt: new Date().toISOString(),
            appliedAt: new Date().toISOString(),
          };
          this.mockRunInterventions.set(applied.interventionId, applied);
          this.emitPush({ type: 'run/intervention-updated', intervention: applied });
        }, 50);
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          ...(adoptedQueuedTurn
            ? { data: { intervention, queuedTurn: adoptedQueuedTurn } }
            : { data: { intervention } }),
        };
      }

      case 'run/intervention-edit': {
        const current = this.mockRunInterventions.get(command.interventionId);
        if (
          !current ||
          current.sessionId !== command.sessionId ||
          current.runId !== command.runId ||
          current.status !== 'pending' ||
          current.revision !== command.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: 'intervention-revision-conflict',
          };
        }
        const updated: RunInterventionRecord = {
          ...current,
          revision: current.revision + 1,
          input: command.input,
          updatedAt: new Date().toISOString(),
        };
        this.mockRunInterventions.set(updated.interventionId, updated);
        const session = this.sessions.get(command.sessionId);
        const messageIndex = session?.transcript.findIndex(
          (message) => message.id === updated.userMessageId,
        );
        if (session && messageIndex !== undefined && messageIndex >= 0) {
          const previous = session.transcript[messageIndex];
          if (previous) {
            session.transcript[messageIndex] = {
              ...previous,
              text: updated.input.text,
              instructionDelivery: {
                kind: 'run-intervention',
                instructionId: updated.interventionId,
                status: updated.status,
                targetRunId: updated.runId,
                revision: updated.revision,
              },
            };
          }
        }
        this.emitPush({ type: 'run/intervention-updated', intervention: updated });
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { intervention: updated },
        };
      }

      case 'run/intervention-cancel': {
        const current = this.mockRunInterventions.get(command.interventionId);
        if (
          !current ||
          current.sessionId !== command.sessionId ||
          current.runId !== command.runId ||
          current.status !== 'pending' ||
          current.revision !== command.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: command.type,
            success: false,
            error: 'intervention-revision-conflict',
          };
        }
        const cancelled: RunInterventionRecord = {
          ...current,
          revision: current.revision + 1,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        };
        this.mockRunInterventions.set(cancelled.interventionId, cancelled);
        this.emitPush({ type: 'run/intervention-updated', intervention: cancelled });
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { intervention: cancelled },
        };
      }

      case 'session/compact': {
        const session = this.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/compact',
            success: false,
            error: `unknown session ${command.sessionId}`,
          };
        }
        this.pushEvent(command.sessionId, { type: 'compaction/start' });
        this.pushEvent(command.sessionId, {
          type: 'compaction/end',
          ok: true,
          message: 'mock compacted',
          summary: 'Mock summary of prior turns for UI testing.',
          tokensBefore: 8000,
          tokensAfter: 2500,
          durationMs: 30,
        });
        return {
          id,
          type: 'response',
          command: 'session/compact',
          success: true,
          data: {
            ok: true,
            message: 'mock compacted',
            summary: 'Mock summary of prior turns for UI testing.',
            tokensBefore: 8000,
            tokensAfter: 2500,
            durationMs: 30,
          },
        };
      }
      case 'session/compact-export': {
        const path =
          command.outputPath?.trim() ||
          `/mock/exports/piwin-compact-${command.sessionId.slice(0, 8)}.md`;
        const summary = 'Mock summary of prior turns for UI testing.';
        const content = `${summary}\n`;
        return {
          id,
          type: 'response',
          command: 'session/compact-export',
          success: true,
          data: {
            sessionId: command.sessionId,
            format: 'md',
            path,
            byteLength: content.length,
            ...(summary ? { summary } : {}),
          },
        };
      }
      case 'session/compact-abort':
        return {
          id,
          type: 'response',
          command: 'session/compact-abort',
          success: true,
          data: { sessionId: command.sessionId },
        };
      case 'session/compaction-settings':
        return {
          id,
          type: 'response',
          command: 'session/compaction-settings',
          success: true,
          data: {
            supported: true,
            autoCompactionEnabled: true,
            source: 'global',
            globalDefault: true,
          },
        };
      case 'session/set-auto-compaction':
        return {
          id,
          type: 'response',
          command: 'session/set-auto-compaction',
          success: true,
          data: { enabled: command.enabled },
        };

      case 'session/list-children': {
        const sessions = this.childIndex?.get(command.parentSessionId) ?? [];
        return {
          id,
          type: 'response',
          command: 'session/list-children',
          success: true,
          data: { parentSessionId: command.parentSessionId, sessions, invocations: [] },
        };
      }
      case 'subagent/continue':
        return {
          id,
          type: 'response',
          command: 'subagent/continue',
          success: true,
          data: {
            runId: `mock-subagent-continuation-${Date.now()}`,
            childSessionId: command.childSessionId,
            acceptedAt: new Date().toISOString(),
          },
        };
      case 'subagent/worktree-action':
        return {
          id,
          type: 'response',
          command: 'subagent/worktree-action',
          success: true,
          data: {
            childSessionId: command.childSessionId,
            action: command.action,
            integrationStatus:
              command.action === 'apply'
                ? 'applied'
                : command.action === 'discard'
                  ? 'discarded'
                  : 'retained',
          },
        };
      case 'plan/get': {
        const plan = this.plans.get(command.sessionId) ?? null;
        return {
          id,
          type: 'response',
          command: 'plan/get',
          success: true,
          data: { sessionId: command.sessionId, plan },
        };
      }
      case 'plan/set': {
        this.plans.set(command.sessionId, command.plan);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: command.plan });
        return {
          id,
          type: 'response',
          command: 'plan/set',
          success: true,
          data: { plan: command.plan },
        };
      }
      case 'plan/clear': {
        this.plans.delete(command.sessionId);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
        return {
          id,
          type: 'response',
          command: 'plan/clear',
          success: true,
          data: { sessionId: command.sessionId },
        };
      }
      case 'plan/approve': {
        const plan = this.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/approve',
            success: false,
            error: 'No plan for session',
          };
        }
        const approved = {
          ...plan,
          status: 'approved' as const,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.plans.set(command.sessionId, approved);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
        return {
          id,
          type: 'response',
          command: 'plan/approve',
          success: true,
          data: { plan: approved },
        };
      }
      case 'plan/execute': {
        const plan = this.plans.get(command.request.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: 'No plan for session',
          };
        }
        if (plan.id !== command.request.planId) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan id mismatch: ${command.request.planId} vs ${plan.id}`,
          };
        }
        if (
          command.request.expectedRevision !== undefined &&
          plan.revision !== command.request.expectedRevision
        ) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan revision mismatch: ${command.request.expectedRevision} vs ${plan.revision}`,
          };
        }
        const canAtomicallyApproveDraft =
          plan.status === 'draft' && command.request.approveDraft === true;
        if (
          plan.status !== 'approved' &&
          plan.status !== 'executing' &&
          !canAtomicallyApproveDraft
        ) {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan must be approved or atomically approved (current: ${plan.status})`,
          };
        }
        const executionState = {
          sessionId: command.request.sessionId,
          planId: plan.id,
          mode: command.request.mode,
          status: 'running' as const,
          childSessionIds: [] as string[],
        };
        const executing = {
          ...plan,
          status: 'executing' as const,
          execution: executionState,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.plans.set(command.request.sessionId, executing);
        this.emitPush({
          type: 'plan/updated',
          sessionId: command.request.sessionId,
          plan: executing,
        });
        this.emitPush({ type: 'plan/execution-updated', state: executionState });
        return {
          id,
          type: 'response',
          command: 'plan/execute',
          success: true,
          data: {
            sessionId: command.request.sessionId,
            planId: plan.id,
            mode: command.request.mode,
            status: 'running',
          },
        };
      }
      case 'plan/abort': {
        const plan = this.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/abort',
            success: false,
            error: 'No plan for session',
          };
        }
        const abortedState = {
          ...(plan.execution ?? {
            sessionId: command.sessionId,
            planId: plan.id,
            mode: 'inline' as const,
            status: 'aborted' as const,
            childSessionIds: [] as string[],
          }),
          status: 'aborted' as const,
          endedAt: new Date().toISOString(),
        };
        const aborted = {
          ...plan,
          status: 'abandoned' as const,
          execution: abortedState,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.plans.set(command.sessionId, aborted);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: aborted });
        this.emitPush({ type: 'plan/execution-updated', state: abortedState });
        return {
          id,
          type: 'response',
          command: 'plan/abort',
          success: true,
          data: { sessionId: command.sessionId, planId: plan.id, status: 'aborted' },
        };
      }

      case 'speech/transcribe': {
        const model = this.mockConfig.speech?.asr?.defaultModel;
        if (!model) {
          return {
            id,
            type: 'response',
            command: 'speech/transcribe',
            success: false,
            error: 'ASR model is not configured.',
          };
        }
        return {
          id,
          type: 'response',
          command: 'speech/transcribe',
          success: true,
          data: { text: 'Mock transcript', model, durationMs: 1 },
        };
      }
      case 'media/save': {
        return {
          id,
          type: 'response',
          command: 'media/save',
          success: true,
          data: { asset: this.createMockMediaAsset(command.input) },
        };
      }
      case 'media/save-begin': {
        const uploadId = crypto.randomUUID();
        this.mockMediaUploads.set(uploadId, {
          sessionId: command.input.sessionId,
          mimeType: command.input.mimeType,
          byteSize: command.input.byteSize,
          ...(command.input.name ? { name: command.input.name } : {}),
        });
        return {
          id,
          type: 'response',
          command: 'media/save-begin',
          success: true,
          data: { uploadId, chunkMaxBytes: 384 * 1024 },
        };
      }
      case 'media/save-chunk': {
        if (!this.mockMediaUploads.has(command.input.uploadId)) {
          return {
            id,
            type: 'response',
            command: 'media/save-chunk',
            success: false,
            error: 'media upload is not active',
          };
        }
        return {
          id,
          type: 'response',
          command: 'media/save-chunk',
          success: true,
          data: { uploadId: command.input.uploadId, receivedBytes: 1 },
        };
      }
      case 'media/save-finish': {
        const pending = this.mockMediaUploads.get(command.input.uploadId);
        if (!pending) {
          return {
            id,
            type: 'response',
            command: 'media/save-finish',
            success: false,
            error: 'media upload is not active',
          };
        }
        this.mockMediaUploads.delete(command.input.uploadId);
        return {
          id,
          type: 'response',
          command: 'media/save-finish',
          success: true,
          data: { asset: this.createMockMediaAsset(pending) },
        };
      }
      case 'media/save-abort': {
        this.mockMediaUploads.delete(command.input.uploadId);
        return {
          id,
          type: 'response',
          command: 'media/save-abort',
          success: true,
          data: { uploadId: command.input.uploadId },
        };
      }
      case 'media/read': {
        const assetId = command.input.assetId;
        const mimeType = assetId.endsWith('.png') ? 'image/png' : 'image/png';
        return {
          id,
          type: 'response',
          command: 'media/read',
          success: true,
          data: {
            status: 'ready',
            assetId,
            sessionId: command.input.sessionId,
            mimeType,
            byteSize: 8,
            base64Data: Buffer.from('mock-media-bytes').toString('base64'),
          },
        };
      }
      case 'preview/read-trusted-text': {
        return {
          id,
          type: 'response',
          command: 'preview/read-trusted-text',
          success: true,
          data: {
            status: 'ready',
            relativePath: command.input.relativePath,
            displayRef: command.input.relativePath,
            content: `# mock trusted text\n\n${command.input.relativePath}\n`,
            byteSize: 32,
            truncated: false,
            readOnly: true,
          },
        };
      }
      case 'preview/export-local-file': {
        const fileName = command.input.absolutePath.split(/[\\/]/).pop() || 'download.bin';
        const mockBytes = new TextEncoder().encode(`mock-export:${command.input.absolutePath}`);
        let binary = '';
        for (const byte of mockBytes) {
          binary += String.fromCharCode(byte);
        }
        return {
          id,
          type: 'response',
          command: 'preview/export-local-file',
          success: true,
          data: {
            status: 'ready',
            fileName,
            mimeType: 'application/octet-stream',
            byteSize: mockBytes.byteLength,
            base64Data: btoa(binary),
          },
        };
      }
      case 'preview/read-local-file': {
        const fileName = command.input.absolutePath.split(/[\\/]/).pop() || 'preview';
        if (/\.(png|jpe?g|gif|webp)$/i.test(fileName)) {
          const extension = fileName.match(/\.[a-z0-9]{1,12}$/iu)?.[0] ?? '.png';
          const assetId = crypto.randomUUID();
          return {
            id,
            type: 'response',
            command: 'preview/read-local-file',
            success: true,
            data: {
              status: 'ready',
              kind: 'media',
              asset: {
                id: assetId,
                sessionId: command.input.sessionId,
                absolutePath: `/tmp/piwin-mock-media/${command.input.sessionId}/${assetId}${extension}`,
                mimeType: 'image/png',
                byteSize: 12,
                createdAt: new Date().toISOString(),
                name: fileName,
              },
            },
          };
        }
        return {
          id,
          type: 'response',
          command: 'preview/read-local-file',
          success: true,
          data: {
            status: 'ready',
            kind: 'text',
            content: `# mock local file\n\n${command.input.absolutePath}\n`,
            byteSize: 32,
            truncated: false,
            readOnly: true,
          },
        };
      }
      case 'git/stage':
      case 'git/unstage':
      case 'git/commit':
      case 'git/branch-create':
      case 'git/checkout':
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            result: {
              kind: command.type.replace('git/', ''),
              ok: true,
              message: `mock ${command.type}`,
            },
          },
        };
      case 'theme/list': {
        const activeThemeId = this.mockActiveThemeId;
        return {
          id,
          type: 'response',
          command: 'theme/list',
          success: true,
          data: {
            activeThemeId,
            themes: [
              {
                id: 'piwin-obsidian',
                name: 'Obsidian',
                version: '1.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-obsidian',
                source: 'bundled',
                active: activeThemeId === 'piwin-obsidian',
              },
              {
                id: 'piwin-bone',
                name: 'Bone',
                version: '1.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-bone',
                source: 'bundled',
                active: activeThemeId === 'piwin-bone',
              },
              {
                id: 'piwin-ink-wash',
                name: '砚夜泼墨',
                version: '1.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-ink-wash',
                source: 'bundled',
                active: activeThemeId === 'piwin-ink-wash',
              },
            ],
          },
        };
      }
      case 'theme/get-active':
      case 'theme/set-active': {
        if (command.type === 'theme/set-active') {
          this.mockActiveThemeId = resolveMockThemeId(command.themeId);
        }
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { theme: mockThemeManifest(this.mockActiveThemeId) },
        };
      }
      case 'theme/install-local':
        return {
          id,
          type: 'response',
          command: 'theme/install-local',
          success: true,
          data: { themeId: 'installed-theme', path: command.sourcePath },
        };
      case 'pet/list':
        return {
          id,
          type: 'response',
          command: 'pet/list',
          success: true,
          data: {
            activePetId: 'piwin-default',
            pets: [
              {
                id: 'piwin-default',
                displayName: 'Piwin Default',
                path: '/mock/pets/piwin-default',
                spritesheetAbsolutePath: '/mock/pets/piwin-default/spritesheet.png',
                source: 'bundled',
                active: true,
                valid: true,
                issues: [],
              },
            ],
          },
        };
      case 'pet/get-active':
      case 'pet/set-active':
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            pet: {
              petId: command.type === 'pet/set-active' ? command.petId : 'piwin-default',
              displayName: 'Piwin Default',
              spritesheetAbsolutePath: '/mock/pets/piwin-default/spritesheet.png',
              state: 'idle',
              fps: 6,
              cellWidth: 48,
              cellHeight: 52,
              cols: 8,
              rows: 9,
              stateRows: {
                idle: 0,
                running: 1,
                waiting: 2,
                failed: 3,
                waving: 4,
                jumping: 5,
                review: 6,
              },
            },
          },
        };
      case 'pet/scan-local':
        return {
          id,
          type: 'response',
          command: 'pet/scan-local',
          success: true,
          data: {
            sourcePath: command.sourcePath,
            candidates: [
              {
                sourcePath: `${command.sourcePath}/mock-pet`,
                petId: 'mock-local-pet',
                displayName: 'Mock Local Pet',
                valid: true,
                issues: [],
              },
            ],
          },
        };
      case 'pet/install-local':
        return {
          id,
          type: 'response',
          command: 'pet/install-local',
          success: true,
          data: { petId: 'installed-pet', path: command.sourcePath },
        };
      case 'pet/install-local-batch':
        return {
          id,
          type: 'response',
          command: 'pet/install-local-batch',
          success: true,
          data: {
            installed: command.sourcePaths.map((sourcePath, index) => ({
              petId: `installed-pet-${index + 1}`,
              source: 'local' as const,
              path: sourcePath,
            })),
            failed: [],
          },
        };
      case 'pet/store-query':
        return {
          id,
          type: 'response',
          command: 'pet/store-query',
          success: true,
          data: {
            results: [
              {
                petId: 'mock-registry-pet',
                displayName: 'Mock Registry Pet',
                description: 'A mock pet from the registry.',
                version: '1.0.0',
                source: 'registry' as const,
                location: 'https://example.com/pets/mock-registry-pet.zip',
                installed: false,
                sha256: '0000000000000000000000000000000000000000000000000000000000000000',
                sizeBytes: 1024,
              },
            ],
          },
        };
      case 'pet/install-registry':
        return {
          id,
          type: 'response',
          command: 'pet/install-registry',
          success: true,
          data: {
            petId: 'mock-registry-pet',
            source: 'registry',
            path: '/mock/pets/mock-registry-pet',
          },
        };
      case 'pet/cancel':
        return {
          id,
          type: 'response',
          command: 'pet/cancel',
          success: true,
          data: { cancelled: true },
        };
      case 'git/status':
        return {
          id,
          type: 'response',
          command: 'git/status',
          success: true,
          data: {
            snapshot: {
              repository: { rootPath: command.projectPath, isRepository: true },
              branch: {
                currentBranch: 'main',
                isDetached: false,
                headCommit: 'abc1234',
                upstreamBranch: 'origin/main',
                ahead: 0,
                behind: 0,
                dirty: true,
              },
              changedFiles: [
                {
                  path: 'README.md',
                  status: 'modified',
                  staged: false,
                  unstaged: true,
                },
              ],
              truncated: false,
              totalChangedFiles: 1,
            },
          },
        };
      case 'git/branch-list':
        return {
          id,
          type: 'response',
          command: 'git/branch-list',
          success: true,
          data: {
            branches: {
              repository: { rootPath: command.projectPath, isRepository: true },
              branches: [
                { name: 'main', current: true, shortHash: 'abc1234' },
                { name: 'feat/demo', current: false, shortHash: 'def5678' },
              ],
              truncated: false,
              totalBranches: 2,
            },
          },
        };
      case 'git/diff-summary':
        return {
          id,
          type: 'response',
          command: 'git/diff-summary',
          success: true,
          data: {
            summary: {
              repository: { rootPath: command.projectPath, isRepository: true },
              files: [{ path: 'README.md', status: 'modified', additions: 3, deletions: 1 }],
              totalAdditions: 3,
              totalDeletions: 1,
              truncated: false,
              totalFiles: 1,
            },
          },
        };
      case 'git/diff-file': {
        const path = command.path;
        const patch = [
          `diff --git a/${path} b/${path}`,
          `--- a/${path}`,
          `+++ b/${path}`,
          '@@ -1,3 +1,4 @@',
          ' keep',
          '-old line',
          '+new line',
          '+extra line',
          ' tail',
          '',
        ].join('\n');
        return {
          id,
          type: 'response',
          command: 'git/diff-file',
          success: true,
          data: {
            diff: {
              repository: { rootPath: command.projectPath, isRepository: true },
              path,
              scope: command.scope ?? 'combined',
              isBinary: false,
              patch,
              truncated: false,
              additions: 2,
              deletions: 1,
            },
          },
        };
      }
      case 'git/log-graph':
        return {
          id,
          type: 'response',
          command: 'git/log-graph',
          success: true,
          data: {
            graph: {
              repository: { rootPath: command.projectPath, isRepository: true },
              nodes: [
                {
                  hash: 'aaaaaaaaaaaaaaaa',
                  shortHash: 'aaaaaaa',
                  subject: 'Mock commit',
                  authorName: 'piwin',
                  authorDateIso: new Date().toISOString(),
                  parentHashes: [],
                },
              ],
              truncated: false,
            },
          },
        };
      case 'skills/list':
        return {
          id,
          type: 'response',
          command: 'skills/list',
          success: true,
          data: {
            skills: [
              {
                id: 'find-skill',
                name: 'find-skill',
                description: 'Mock bundled skill',
                source: 'bundled',
                path: '/mock/skills/find-skill',
                enabled: true,
              },
              {
                id: 'create-skill',
                name: 'create-skill',
                description: 'Create a new Agent Skill',
                source: 'bundled',
                path: '/mock/skills/create-skill',
                enabled: true,
              },
              {
                id: 'writing-plans',
                name: 'writing-plans',
                description: 'Write implementation plans',
                source: 'bundled',
                path: '/mock/skills/writing-plans',
                enabled: true,
              },
            ],
          },
        };
      case 'skills/read': {
        const skillIdRaw =
          (typeof command.skillId === 'string' && command.skillId.trim()) ||
          (typeof command.legacyPath === 'string'
            ? command.legacyPath.replace(/\\/g, '/').match(/\/skills\/([^/]+)/i)?.[1]
            : null) ||
          'executing-plans';
        const skillId = String(skillIdRaw).toLowerCase();
        return {
          id,
          type: 'response',
          command: 'skills/read',
          success: true,
          data: {
            status: 'ready',
            skillId,
            name: skillId,
            effectiveSource: 'user',
            origin: 'unknown',
            displayRef: `skill:${skillId}`,
            content: `---\nname: ${skillId}\ndescription: Mock skill\n---\n\n# ${skillId}\n\nMock skill body for Doc Preview.\n`,
            byteSize: 64,
            truncated: false,
            provenance: 'current-resource',
          },
        };
      }
      case 'skills/install':
        return {
          id,
          type: 'response',
          command: 'skills/install',
          success: true,
          data: {
            skillId: command.name ?? 'mock-skill',
            targetPath: '/mock/.piwin/skills/mock-skill',
          },
        };
      case 'skills/set_enabled':
        return {
          id,
          type: 'response',
          command: 'skills/set_enabled',
          success: true,
          data: {
            skillId: command.skillId,
            enabled: command.enabled,
            disabledIds: command.enabled ? [] : [command.skillId],
          },
        };
      case 'extensions/list': {
        const extensions = [
          {
            id: 'path-guard',
            name: 'path-guard',
            description: 'Block write/edit targeting secret-like paths (.env, keys, credentials).',
            source: 'bundled' as const,
            path: '/mock/.piwin/extensions/path-guard.ts',
            enabled: !this.mockDisabledExtensionIds.has('path-guard'),
          },
          {
            id: 'goal',
            name: 'goal',
            description: 'Autonomous goal execution loop and tracking extension (@narumitw/pi-goal).',
            source: 'bundled' as const,
            path: '/mock/.piwin/extensions/goal.ts',
            enabled: !this.mockDisabledExtensionIds.has('goal'),
          },
        ];
        if (!this.mockBundledExtensionsInstalled) {
          return {
            id,
            type: 'response',
            command: 'extensions/list',
            success: true,
            data: { extensions: [] },
          };
        }
        return {
          id,
          type: 'response',
          command: 'extensions/list',
          success: true,
          data: { extensions },
        };
      }
      case 'extensions/set_enabled': {
        if (command.enabled) {
          this.mockDisabledExtensionIds.delete(command.extensionId);
        } else {
          this.mockDisabledExtensionIds.add(command.extensionId);
        }
        return {
          id,
          type: 'response',
          command: 'extensions/set_enabled',
          success: true,
          data: {
            extensionId: command.extensionId,
            enabled: command.enabled,
            disabledIds: [...this.mockDisabledExtensionIds],
          },
        };
      }
      case 'extensions/apply': {
        if (!this.sessions.has(command.sessionId)) {
          return {
            id,
            type: 'response',
            command: 'extensions/apply',
            success: false,
            error: `Unknown session: ${command.sessionId}`,
          };
        }
        return {
          id,
          type: 'response',
          command: 'extensions/apply',
          success: true,
          data: {
            sessionId: command.sessionId,
            deploymentId: command.deploymentId ?? `mock-deployment-${Date.now()}`,
            state: command.when === 'new-sessions-only' ? 'new-sessions-only' : 'active',
            when: command.when,
            registryRevision: 'mock-extension-registry',
            generationId: `mock-generation-${command.sessionId}`,
          },
        };
      }
      case 'extensions/ensure-bundled': {
        const installed = this.mockBundledExtensionsInstalled ? [] : ['path-guard', 'goal'];
        this.mockBundledExtensionsInstalled = true;
        return {
          id,
          type: 'response',
          command: 'extensions/ensure-bundled',
          success: true,
          data: { installed },
        };
      }
      case 'extensions/install':
        return {
          id,
          type: 'response',
          command: 'extensions/install',
          success: true,
          data: {
            extensionId: command.name ?? 'mock-extension',
            targetPath: '/mock/.piwin/extensions/mock-extension.ts',
          },
        };
      case 'plugins/list':
        return {
          id,
          type: 'response',
          command: 'plugins/list',
          success: true,
          data: { plugins: [] },
        };
      case 'plugins/install':
        return {
          id,
          type: 'response',
          command: 'plugins/install',
          success: true,
          data: {
            pluginId: 'mock-plugin',
            installedSkills: [],
            mcpServerIds: [],
            secretRefs: [],
          },
        };
      case 'plugins/uninstall':
        return {
          id,
          type: 'response',
          command: 'plugins/uninstall',
          success: true,
          data: { pluginId: command.pluginId ?? '', removed: null },
        };
      case 'plugins/registry/list':
        return {
          id,
          type: 'response',
          command: 'plugins/registry/list',
          success: true,
          data: { index: { version: 1, plugins: [] } },
        };
      case 'plugins/secrets/collect':
        return {
          id,
          type: 'response',
          command: 'plugins/secrets/collect',
          success: true,
          data: { pluginId: command.pluginId ?? '', secretRefs: [] },
        };
      case 'prompts/list':
        return {
          id,
          type: 'response',
          command: 'prompts/list',
          success: true,
          data: {
            prompts: [
              {
                id: 'review',
                name: 'review',
                description: 'Review recent changes',
                source: 'bundled',
                path: '/mock/.piwin/prompts/review.md',
                enabled: !this.mockDisabledPromptIds.has('review'),
              },
            ],
          },
        };
      case 'extension/ui_resolve':
        return {
          id,
          type: 'response',
          command: 'extension/ui_resolve',
          success: true,
          data: { requestId: command.requestId, ok: true },
        };
      case 'prompts/set_enabled': {
        if (command.enabled) {
          this.mockDisabledPromptIds.delete(command.promptId);
        } else {
          this.mockDisabledPromptIds.add(command.promptId);
        }
        return {
          id,
          type: 'response',
          command: 'prompts/set_enabled',
          success: true,
          data: {
            promptId: command.promptId,
            enabled: command.enabled,
            disabledIds: [...this.mockDisabledPromptIds],
          },
        };
      }

      case 'job/list':
        return {
          id,
          type: 'response',
          command: 'job/list',
          success: true,
          data: { jobs: [...this.mockJobs.values()] },
        };
      case 'job/get': {
        const job = this.mockJobs.get(command.jobId);
        if (!job) {
          return {
            id,
            type: 'response',
            command: 'job/get',
            success: false,
            error: `Unknown job: ${command.jobId}`,
          };
        }
        return {
          id,
          type: 'response',
          command: 'job/get',
          success: true,
          data: { job },
        };
      }
      case 'job/start': {
        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const record: import('@piwin/contracts').JobRecord = {
          jobId,
          kind: command.input.kind,
          lifetime: command.input.lifetime,
          command: command.input.command,
          argv: [...command.input.argv],
          cwd: command.input.cwd,
          status: 'running',
          startedAt: now,
          latestLogCursor: 0,
          ...(command.input.ownerRunId ? { ownerRunId: command.input.ownerRunId } : {}),
          ...(command.input.ownerSessionId ? { ownerSessionId: command.input.ownerSessionId } : {}),
          ...(command.input.ownerProjectPath
            ? { ownerProjectPath: command.input.ownerProjectPath }
            : {}),
          ...(command.input.label ? { label: command.input.label } : {}),
        };
        this.mockJobs.set(jobId, record);
        this.mockJobLogs.set(jobId, `[mock] started ${command.input.command}\n`);
        this.emitPush({ type: 'job/started', job: { ...record } });
        this.emitPush({ type: 'job/updated', job: { ...record } });
        return {
          id,
          type: 'response',
          command: 'job/start',
          success: true,
          data: { job: record },
        };
      }
      case 'job/wait': {
        const existing = this.mockJobs.get(command.input.jobId);
        if (!existing) {
          return {
            id,
            type: 'response',
            command: 'job/wait',
            success: false,
            error: `Unknown job: ${command.input.jobId}`,
          };
        }
        if (isJobTerminal(existing.status)) {
          return {
            id,
            type: 'response',
            command: 'job/wait',
            success: true,
            data: { job: existing },
          };
        }
        // No mock child ever terminates on its own; a wait on an active job
        // resolves only when the caller stops it (or the timeout elapses).
        const timeoutMs = command.input.timeoutMs ?? 120_000;
        const deadline = Date.now() + timeoutMs;
        return await new Promise<HostResponse>((resolve) => {
          const startedAt = Date.now();
          const poll = (): void => {
            const current = this.mockJobs.get(command.input.jobId);
            if (current && isJobTerminal(current.status)) {
              resolve({
                id,
                type: 'response',
                command: 'job/wait',
                success: true,
                data: { job: current },
              });
              return;
            }
            if (Date.now() >= deadline || Date.now() - startedAt >= timeoutMs) {
              resolve({
                id,
                type: 'response',
                command: 'job/wait',
                success: false,
                error: `job wait timeout: ${command.input.jobId}`,
              });
              return;
            }
            setTimeout(poll, 50);
          };
          poll();
        });
      }
      case 'job/logs': {
        const text = this.mockJobLogs.get(command.input.jobId) ?? '';
        return {
          id,
          type: 'response',
          command: 'job/logs',
          success: true,
          data: {
            jobId: command.input.jobId,
            chunks: text
              ? [
                  {
                    jobId: command.input.jobId,
                    stream: 'stdout' as const,
                    text,
                    at: new Date().toISOString(),
                    cursor: 0,
                  },
                ]
              : [],
            nextCursor: 0,
            hasMore: false,
          },
        };
      }
      case 'job/stop': {
        const existing = this.mockJobs.get(command.jobId);
        if (!existing) {
          return {
            id,
            type: 'response',
            command: 'job/stop',
            success: false,
            error: `Unknown job: ${command.jobId}`,
          };
        }
        const stopped = {
          ...existing,
          status: 'cancelled' as const,
          endedAt: new Date().toISOString(),
          terminalReason: 'user-stop' as const,
        };
        this.mockJobs.set(command.jobId, stopped);
        this.emitPush({ type: 'job/updated', job: { ...stopped } });
        this.emitPush({ type: 'job/exited', job: { ...stopped } });
        return {
          id,
          type: 'response',
          command: 'job/stop',
          success: true,
          data: {
            job: stopped,
            cleanup: {
              requestedJobIds: [command.jobId],
              stoppedJobIds: [command.jobId],
              alreadyTerminalJobIds: [],
              failedJobIds: [],
            },
          },
        };
      }
      case 'mcp/status':
        return {
          id,
          type: 'response',
          command: 'mcp/status',
          success: true,
          data: { servers: [] },
        };
      case 'mcp/start':
      case 'mcp/stop': {
        const health: {
          serverId: string;
          status: 'error' | 'stopped';
          command: string;
          disabled: boolean;
          toolCount: number;
          lastError?: string;
        } = {
          serverId: command.serverId,
          status: command.type === 'mcp/start' ? 'error' : 'stopped',
          command: 'mock',
          disabled: false,
          toolCount: 0,
        };
        if (command.type === 'mcp/start') {
          health.lastError = 'mock transport cannot start MCP';
        }
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: { health },
        };
      }
      case 'mcp/get':
        return {
          id,
          type: 'response',
          command: 'mcp/get',
          success: true,
          data: {
            path: '~/.piwin/mcp.json',
            document: this.mockMcpDocument,
          },
        };
      case 'mcp/validate': {
        const document = command.document as { mcpServers?: unknown };
        if (!document || typeof document !== 'object' || !document.mcpServers) {
          return {
            id,
            type: 'response',
            command: 'mcp/validate',
            success: true,
            data: {
              valid: false,
              issues: [{ path: 'mcpServers', message: 'missing mcpServers' }],
            },
          };
        }
        return {
          id,
          type: 'response',
          command: 'mcp/validate',
          success: true,
          data: { valid: true, document },
        };
      }
      case 'mcp/save': {
        const document = (command.document ?? {
          mcpServers: {},
        }) as import('@piwin/contracts').McpConfigDocument;
        if (!document.mcpServers || typeof document.mcpServers !== 'object') {
          return {
            id,
            type: 'response',
            command: 'mcp/save',
            success: false,
            error: 'invalid mcp document',
          };
        }
        this.mockMcpDocument = {
          mcpServers: { ...document.mcpServers },
        };
        return {
          id,
          type: 'response',
          command: 'mcp/save',
          success: true,
          data: {
            path: '~/.piwin/mcp.json',
            document: this.mockMcpDocument,
          },
        };
      }
      case 'mcp/list_tools':
        return {
          id,
          type: 'response',
          command: 'mcp/list_tools',
          success: true,
          data: {
            serverId: command.serverId,
            tools: [
              {
                serverId: command.serverId,
                name: 'echo',
                exposedName: `mcp__${command.serverId}__echo`,
                description: 'Mock MCP tool',
              },
            ],
          },
        };
      case 'permission/resolve':
        return {
          id,
          type: 'response',
          command: 'permission/resolve',
          success: true,
          data: { requestId: command.requestId, decision: command.decision },
        };
      case 'plan/update-step': {
        const plan = this.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/update-step',
            success: false,
            error: 'No plan for session',
          };
        }
        const steps = plan.steps.map((step) => {
          if (step.id !== command.stepId) {
            if (command.status === 'active' && step.status === 'active') {
              return { ...step, status: 'pending' as const };
            }
            return step;
          }
          const next = { ...step, status: command.status };
          if (typeof command.detail === 'string' && command.detail) {
            next.detail = command.detail.slice(0, 500);
          }
          return next;
        });
        let status = plan.status;
        if (status === 'approved' && (command.status === 'active' || command.status === 'done')) {
          status = 'executing';
        }
        if (
          steps.length > 0 &&
          steps.every((step) => step.status === 'done' || step.status === 'skipped')
        ) {
          status = 'done';
        }
        const updated = {
          ...plan,
          steps,
          status,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.plans.set(command.sessionId, updated);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
        return {
          id,
          type: 'response',
          command: 'plan/update-step',
          success: true,
          data: { plan: updated },
        };
      }
      case 'plan/set-status': {
        const plan = this.plans.get(command.sessionId);
        if (!plan) {
          return {
            id,
            type: 'response',
            command: 'plan/set-status',
            success: false,
            error: 'No plan for session',
          };
        }
        const updated = {
          ...plan,
          status: command.status,
          revision: plan.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        this.plans.set(command.sessionId, updated);
        this.emitPush({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
        return {
          id,
          type: 'response',
          command: 'plan/set-status',
          success: true,
          data: { plan: updated },
        };
      }
      case 'config/get':
        return {
          id,
          type: 'response',
          command: 'config/get',
          success: true,
          data: {
            root: '~/.piwin',
            config: this.mockConfig,
          },
        };
      case 'permissions/get-rules':
        return {
          id,
          type: 'response',
          command: 'permissions/get-rules',
          success: true,
          data: {
            layer: 'user',
            rules: this.mockUserPermissionRules,
            revision: this.mockUserPermissionRulesRevision,
          },
        };
      case 'permissions/set-rules':
        this.mockUserPermissionRules = command.rules;
        this.mockUserPermissionRulesRevision = `mock-rules-${Date.now()}`;
        return {
          id,
          type: 'response',
          command: 'permissions/set-rules',
          success: true,
          data: {
            layer: 'user',
            rules: this.mockUserPermissionRules,
            revision: this.mockUserPermissionRulesRevision,
          },
        };
      case 'settings/get':
        return {
          id,
          type: 'response',
          command: 'settings/get',
          success: true,
          data: {
            root: '~/.piwin',
            snapshot: {
              schemaVersion: 2,
              revision: this.mockSettingsRevision,
              runtimeRevision: this.mockRuntimeSettingsRevision,
              domainRevisions: {},
              config: this.mockConfig,
            },
          },
        };
      case 'web/search-route-preview': {
        const hasEnabledSources = command.input.searchSources.some((source) => source.enabled);
        const hasDelegateModel = command.input.searchDelegateModel !== undefined;
        const externalReady = hasDelegateModel || hasEnabledSources;
        const data: SearchRoutePreviewData = {
          route: {
            policy: command.input.policy,
            selected: externalReady ? 'external' : null,
            fallback: null,
            readiness: {
              native: {
                ready: false,
                modelTagged: false,
                adapterRequestSupported: false,
                adapterCitationSupported: false,
                reasons: ['mock host does not provide a selected native-search model'],
              },
              external: {
                ready: externalReady,
                hasEnabledSources,
                hasDelegateModel,
                reasons: externalReady ? [] : ['no enabled external search source'],
              },
            },
            issues: externalReady
              ? []
              : [
                  'no enabled external search source',
                  'no search backend is ready for the configured policy',
                ],
          },
        };
        return {
          id,
          type: 'response',
          command: 'web/search-route-preview',
          success: true,
          data,
        };
      }
      case 'settings/apply': {
        const input = command.input;
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== this.mockSettingsRevision
        ) {
          return {
            id,
            type: 'response',
            command: 'settings/apply',
            success: false,
            error: 'settings-revision-conflict',
          };
        }
        let nextConfig = this.mockConfig;
        for (const mutation of input.mutations) {
          if (mutation.kind !== 'replace-domain') {
            return {
              id,
              type: 'response',
              command: 'settings/apply',
              success: false,
              error: 'unsupported mutation kind',
            };
          }
          nextConfig = {
            ...nextConfig,
            [mutation.domain]: mutation.value,
          } as import('@piwin/contracts').PiwinConfig;
        }
        this.mockConfig = nextConfig;
        this.mockSettingsRevision = `mock-settings-v${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        if (
          input.mutations.some(
            (mutation) =>
              !['desktop', 'media', 'artifact', 'automation', 'visionDelegation', 'replyWriter'].includes(
                mutation.domain,
              ),
          )
        ) {
          this.mockRuntimeSettingsRevision = `mock-runtime-settings-v${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        }
        return {
          id,
          type: 'response',
          command: 'settings/apply',
          success: true,
          data: {
            snapshot: {
              schemaVersion: 2,
              revision: this.mockSettingsRevision,
              runtimeRevision: this.mockRuntimeSettingsRevision,
              domainRevisions: {},
              config: this.mockConfig,
            },
            changedDomains: input.mutations.map((mutation) => ({
              domain: mutation.domain,
              timing: 'new-runtime',
              runtimeSchemaChanged: true,
              immediateRestrictions: mutation.domain === 'permissions' ? ['permission-policy'] : [],
              securityTightenedImmediately: mutation.domain === 'permissions',
            })),
          },
        };
      }
      case 'secrets/set': {
        const store = this as { _mockSecrets?: Map<string, string> };
        if (!store._mockSecrets) store._mockSecrets = new Map();
        store._mockSecrets.set(command.providerId, command.secret);
        return {
          id,
          type: 'response',
          command: 'secrets/set',
          success: true,
          data: {
            providerId: command.providerId,
            apiKeyRef: `keychain:piwin-${command.providerId}`,
          },
        };
      }
      case 'secrets/get': {
        const store = this as { _mockSecrets?: Map<string, string> };
        const secret = store._mockSecrets?.get(command.providerId) ?? '';
        const keys = secret
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter(Boolean)
          .map((value: string, index: number) => ({
            index,
            preview: value.length > 10 ? `${value.slice(0, 6)}******${value.slice(-4)}` : '****',
          }));
        return {
          id,
          type: 'response',
          command: 'secrets/get',
          success: true,
          data: { providerId: command.providerId, keys, secret },
        };
      }
      case 'models/discover': {
        const modelsByProtocol: Record<
          import('@piwin/contracts').ModelProviderConfig['protocol'],
          import('@piwin/contracts').DiscoveredModel[]
        > = {
          'openai-compatible': [
            { id: 'deepseek-chat', label: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
            { id: 'custom-reasoning-model', label: 'Custom Reasoning Model' },
          ],
          'anthropic-compatible': [
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
          ],
          'google-gemini': [
            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          ],
        };
        return {
          id,
          type: 'response',
          command: 'models/discover',
          success: true,
          data: {
            providerId: command.provider.id,
            protocol: command.provider.protocol,
            models: modelsByProtocol[command.provider.protocol],
          },
        };
      }
      case 'models/test': {
        return {
          id,
          type: 'response',
          command: 'models/test',
          success: true,
          data: {
            providerId: command.provider.id,
            modelId: command.modelId,
            durationMs: 42,
          },
        };
      }
      case 'models/image-test': {
        return {
          id,
          type: 'response',
          command: 'models/image-test',
          success: true,
          data: {
            providerId: command.provider.id,
            modelId: command.modelId,
            durationMs: 42,
            imageCount: 1,
            outputs: [{ mimeType: 'image/png', byteSize: 1024 }],
          },
        };
      }
      case 'models/image-catalog/search': {
        return {
          id,
          type: 'response',
          command: 'models/image-catalog/search',
          success: true,
          data: {
            entries: [],
            catalogVersion: 'mock',
          },
        };
      }
      case 'session/pin': {
        const session = this.sessions.get(command.sessionId);
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
            session: this.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/unpin': {
        const session = this.sessions.get(command.sessionId);
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
            session: this.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/rename': {
        const session = this.sessions.get(command.sessionId);
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
            session: this.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/archive': {
        const session = this.sessions.get(command.sessionId);
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
            session: this.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/unarchive': {
        const session = this.sessions.get(command.sessionId);
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
            session: this.mockSessionSummary(command.sessionId, session),
          },
        };
      }
      case 'session/delete': {
        const session = this.sessions.get(command.sessionId);
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
        this.sessions.delete(command.sessionId);
        return {
          id,
          type: 'response',
          command: 'session/delete',
          success: true,
          data: { sessionId: command.sessionId, deleted: true },
        };
      }

      case 'session/duplicate': {
        const session = this.sessions.get(command.sessionId);
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
        this.copyMockAssemblySummaries(command.sessionId, newId, messageIdMap);
        const origin: ProductSessionOrigin = {
          kind: 'duplicate',
          sourceSessionId: command.sessionId,
          ...(session.name ? { sourceSessionNameSnapshot: session.name } : {}),
          createdAt: new Date().toISOString(),
        };
        this.sessions.set(newId, {
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
        const duplicatedSession = this.sessions.get(newId);
        if (!duplicatedSession) {
          throw new Error(`Mock duplicate session was not stored: ${newId}`);
        }
        const summary = this.mockSessionSummary(newId, duplicatedSession);
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
        const session = this.sessions.get(command.sessionId);
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
                this.mockGetDirectForkNames(command.sessionId),
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
        this.copyMockAssemblySummaries(command.sessionId, newForkId, messageIdMap, retainedRunIds);
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
        this.sessions.set(newForkId, {
          projectPath: session.projectPath,
          events: [],
          transcript: forkTranscript,
          name: forkName,
          isPinned: false,
          isArchived: false,
          origin,
        });
        const forkedSession = this.sessions.get(newForkId);
        if (!forkedSession) {
          throw new Error(`Mock fork session was not stored: ${newForkId}`);
        }
        const forkSummary = this.mockSessionSummary(newForkId, forkedSession);
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
          data: this.mockBuildSessionLineage(command.sessionId),
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
            summaries: this.mockAssemblySummaries.get(command.sessionId) ?? [],
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
        const hits = [...this.sessions.entries()]
          .map(([sessionId, value]) => ({
            sessionId,
            value,
            summary: this.mockSessionSummary(sessionId, value),
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
        const cold = this.mockConfig.session?.coldStorage;
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
        const session = this.sessions.get(
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
        const session = this.sessions.get(command.sessionId);
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
        const session = this.sessions.get(command.sessionId);
        if (!session) {
          return {
            id,
            type: 'response',
            command: 'session/branch-switch',
            success: false,
            error: 'unknown session',
          };
        }
        if (this.mockActiveRunIds.get(command.sessionId)) {
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
          this.emitPush({
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
              session: this.mockSessionSummary(command.sessionId, session),
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
        const session = this.sessions.get(command.sessionId);
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
        this.emitPush({
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
      case 'pty/open': {
        const ptyId = crypto.randomUUID();
        const projectPath = command.input.projectPath;
        this.mockPtys.set(ptyId, { projectPath });
        queueMicrotask(() => {
          this.emitPush({
            type: 'pty/output',
            ptyId,
            data: `mock shell @ ${projectPath}\n$ `,
            at: new Date().toISOString(),
          });
        });
        return {
          id,
          type: 'response',
          command: 'pty/open',
          success: true,
          data: {
            pty: {
              id: ptyId,
              projectPath,
              cwd: command.input.cwd ?? projectPath,
              createdAt: new Date().toISOString(),
              status: 'open',
            },
          },
        };
      }
      case 'pty/write': {
        if (!this.mockPtys.has(command.ptyId)) {
          return {
            id,
            type: 'response',
            command: 'pty/write',
            success: false,
            error: `unknown pty ${command.ptyId}`,
          };
        }
        const data = command.data;
        queueMicrotask(() => {
          this.emitPush({
            type: 'pty/output',
            ptyId: command.ptyId,
            data: data.startsWith('\n') ? data : data,
            at: new Date().toISOString(),
          });
          if (data.includes('\n')) {
            this.emitPush({
              type: 'pty/output',
              ptyId: command.ptyId,
              data: `ok\n$ `,
              at: new Date().toISOString(),
            });
          }
        });
        return {
          id,
          type: 'response',
          command: 'pty/write',
          success: true,
          data: { ptyId: command.ptyId },
        };
      }
      case 'pty/resize':
        return {
          id,
          type: 'response',
          command: 'pty/resize',
          success: true,
          data: { ptyId: command.ptyId },
        };
      case 'pty/close': {
        this.mockPtys.delete(command.ptyId);
        queueMicrotask(() => {
          this.emitPush({ type: 'pty/exit', ptyId: command.ptyId, exitCode: 0 });
        });
        return {
          id,
          type: 'response',
          command: 'pty/close',
          success: true,
          data: { ptyId: command.ptyId },
        };
      }
      case 'pty/list': {
        const sessions = [...this.mockPtys.entries()].map(([ptyId, value]) => ({
          id: ptyId,
          projectPath: value.projectPath,
          cwd: value.projectPath,
          createdAt: new Date().toISOString(),
          status: 'open' as const,
        }));
        return { id, type: 'response', command: 'pty/list', success: true, data: { sessions } };
      }
      case 'skills/store-list':
        return {
          id,
          type: 'response',
          command: 'skills/store-list',
          success: true,
          data: {
            entries: [
              {
                id: 'mock-skill-creator',
                name: 'skill-creator',
                description: 'Mock store skill for e2e',
                source: {
                  kind: 'git',
                  url: 'https://github.com/anthropics/skills.git',
                  subdir: 'skills/skill-creator',
                },
              },
            ],
          },
        };
      case 'mcp/registry-list':
        return {
          id,
          type: 'response',
          command: 'mcp/registry-list',
          success: true,
          data: {
            cards: [
              {
                id: 'filesystem',
                title: 'Filesystem',
                description: 'Mock registry filesystem server',
                source: 'static',
                installDraft: {
                  command: 'npx',
                  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
                },
              },
            ],
          },
        };
      case 'mcp/registry-install-draft': {
        this.mockMcpDocument.mcpServers[command.serverId] = command.draft;
        return {
          id,
          type: 'response',
          command: 'mcp/registry-install-draft',
          success: true,
          data: { serverId: command.serverId, document: this.mockMcpDocument },
        };
      }
      case 'cron/list':
        return {
          id,
          type: 'response',
          command: 'cron/list',
          success: true,
          data: { version: 1, jobs: this.mockCronJobs },
        };
      case 'cron/upsert': {
        const job = command.job;
        const index = this.mockCronJobs.findIndex((item) => item.id === job.id);
        if (index === -1) this.mockCronJobs.push(job);
        else this.mockCronJobs[index] = job;
        return { id, type: 'response', command: 'cron/upsert', success: true, data: { job } };
      }
      case 'cron/delete': {
        this.mockCronJobs = this.mockCronJobs.filter((item) => item.id !== command.jobId);
        return {
          id,
          type: 'response',
          command: 'cron/delete',
          success: true,
          data: { deleted: true },
        };
      }
      case 'cron/run': {
        const job = this.mockCronJobs.find((item) => item.id === command.jobId);
        if (!job) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: `unknown job ${command.jobId}`,
          };
        }
        const automation = this.mockConfig.automation;
        if (automation?.enabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: 'automation disabled (config.automation.enabled)',
          };
        }
        if (automation?.cronEnabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: 'cron disabled (config.automation.cronEnabled)',
          };
        }
        if (job.enabled !== true) {
          return {
            id,
            type: 'response',
            command: 'cron/run',
            success: false,
            error: `job ${job.id} is disabled`,
          };
        }
        job.lastRunAt = new Date().toISOString();
        job.lastStatus = 'ok';
        this.emitPush({
          type: 'automation/cron_finished',
          jobId: job.id,
          ok: true,
          message: 'mock run',
        });
        return {
          id,
          type: 'response',
          command: 'cron/run',
          success: true,
          data: { ok: true, message: 'mock run' },
        };
      }
      case 'hooks/list':
        return {
          id,
          type: 'response',
          command: 'hooks/list',
          success: true,
          data: { version: 1, hooks: this.mockHooks },
        };
      case 'hooks/set': {
        this.mockHooks = command.hooks;
        return {
          id,
          type: 'response',
          command: 'hooks/set',
          success: true,
          data: { version: 1, hooks: this.mockHooks },
        };
      }
      case 'todo/get':
        return {
          id,
          type: 'response',
          command: 'todo/get',
          success: true,
          data: {
            sessionId: command.sessionId,
            items: [],
            updatedAt: new Date().toISOString(),
            revision: 'empty',
          },
        };
      case 'todo/set':
        return {
          id,
          type: 'response',
          command: 'todo/set',
          success: true,
          data: {
            sessionId: command.sessionId,
            items: command.items,
            updatedAt: new Date().toISOString(),
            revision: 'empty',
          },
        };

      // --- Browser session commands (ADR 0020 §6) ---------------------------
      case 'browser/start': {
        this.mockBrowserUrl = 'about:blank';
        return { id, type: 'response', command: 'browser/start', success: true, data: null };
      }
      case 'browser/navigate': {
        this.mockBrowserUrl = command.url;
        this.emitPush({
          type: 'browser/state',
          url: command.url,
          title: command.url,
          ts: Date.now(),
        });
        return { id, type: 'response', command: 'browser/navigate', success: true, data: null };
      }
      case 'browser/pick-at': {
        const result: import('@piwin/contracts').WebElementPickResult = {
          url: this.mockBrowserUrl ?? 'about:blank',
          selector: 'div.pick-target',
          text: 'Picked element text',
          boundingRect: {
            x: Math.max(0, command.x - 20),
            y: Math.max(0, command.y - 10),
            width: 40,
            height: 20,
          },
        };
        this.emitPush({ type: 'browser/picked', result });
        return {
          id,
          type: 'response',
          command: 'browser/pick-at',
          success: true,
          data: { result },
        };
      }
      case 'browser/screenshot':
        return { id, type: 'response', command: 'browser/screenshot', success: true, data: null };
      case 'browser/stop':
        this.mockBrowserUrl = null;
        return { id, type: 'response', command: 'browser/stop', success: true, data: null };
      case 'browser/input':
        return { id, type: 'response', command: 'browser/input', success: true, data: null };
      case 'browser/lock': {
        if (command.owner === 'agent') this.mockBrowserAgentWantsLock = true;
        const owner = command.owner === 'user' ? 'user' : 'agent';
        this.emitPush({
          type: 'browser/controller',
          owner,
          ts: Date.now(),
          ...(this.mockBrowserAgentWantsLock ? { agentWantsLock: true } : {}),
        });
        return { id, type: 'response', command: 'browser/lock', success: true, data: null };
      }
      case 'browser/unlock': {
        const owner =
          command.owner === 'user'
            ? this.mockBrowserAgentWantsLock
              ? 'agent'
              : 'idle'
            : 'idle';
        if (command.owner !== 'user' || !this.mockBrowserAgentWantsLock) {
          this.mockBrowserAgentWantsLock = false;
        }
        this.emitPush({
          type: 'browser/controller',
          owner,
          ts: Date.now(),
          ...(this.mockBrowserAgentWantsLock ? { agentWantsLock: true } : {}),
        });
        return { id, type: 'response', command: 'browser/unlock', success: true, data: null };
      }
      case 'browser/resize':
        return {
          id,
          type: 'response',
          command: 'browser/resize',
          success: true,
          data: { viewport: { width: command.width, height: command.height } },
        };

      // --- Walkthrough commands (spec §12) ---------------------------------
      case 'walkthrough/list': {
        // Deterministic mock: synthesize a ready artifact for the first
        // assistant transcript message when one exists, so the doc view and
        // card have something to render in mock/e2e mode.
        const session = this.sessions.get(command.sessionId);
        const artifacts: WalkthroughArtifact[] = [];
        if (session) {
          for (const msg of session.transcript) {
            if (msg.role !== 'assistant') continue;
            const model: ModelRef = {
              protocol: 'openai-compatible',
              providerId: 'mock',
              modelId: 'mock-walkthrough',
            };
            artifacts.push({
              version: 1,
              id: `wt-${msg.id}`,
              sessionId: command.sessionId,
              messageId: msg.id,
              mode: 'default',
              model,
              sourceHash: 'mock-source-hash',
              createdAt: msg.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              status: 'ready',
              markdown: `# Walkthrough\n\n## Summary\n\nMock walkthrough for message ${msg.id}.\n`,
              generatedAt: new Date().toISOString(),
            });
            break;
          }
        }
        return {
          id,
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: command.sessionId, artifacts },
        };
      }
      case 'walkthrough/generate': {
        // No provider configured → model-unavailable (spec §5.2 error mapping).
        if (this.mockConfig.providers.length === 0) {
          return {
            id,
            type: 'response',
            command: 'walkthrough/generate',
            success: false,
            error: 'model-unavailable',
          };
        }
        const generationId = crypto.randomUUID();
        const now = new Date().toISOString();
        const model: ModelRef = {
          protocol: this.mockConfig.providers[0]?.protocol ?? 'openai-compatible',
          providerId: this.mockConfig.providers[0]?.id ?? 'mock',
          modelId: this.mockConfig.providers[0]?.models[0]?.id ?? 'mock-walkthrough',
        };
        // Publish `generating` immediately so the UI shows the loading state.
        const generatingArtifact: WalkthroughArtifact = {
          version: 1,
          id: `wt-${command.messageId}`,
          sessionId: command.sessionId,
          messageId: command.messageId,
          ...(command.runId ? { runId: command.runId } : {}),
          mode: 'default',
          model,
          sourceHash: 'mock-source-hash',
          createdAt: now,
          updatedAt: now,
          status: 'generating',
          generationId,
        };
        this.emitPush({
          type: 'walkthrough/updated',
          sessionId: command.sessionId,
          artifact: generatingArtifact,
        });
        // Delayed `ready` push simulates async generation completion.
        const sessionId = command.sessionId;
        const messageId = command.messageId;
        const readyModel = model;
        const emitPush = this.emitPush;
        setTimeout(() => {
          const readyNow = new Date().toISOString();
          const readyArtifact: WalkthroughArtifact = {
            version: 1,
            id: `wt-${messageId}`,
            sessionId,
            messageId,
            mode: 'default',
            model: readyModel,
            sourceHash: 'mock-source-hash',
            createdAt: readyNow,
            updatedAt: readyNow,
            status: 'ready',
            markdown: `# Walkthrough\n\n## Summary\n\nGenerated walkthrough for message ${messageId}.\n`,
            generatedAt: readyNow,
          };
          emitPush({ type: 'walkthrough/updated', sessionId, artifact: readyArtifact });
        }, 50);
        return {
          id,
          type: 'response',
          command: 'walkthrough/generate',
          success: true,
          data: {
            sessionId: command.sessionId,
            messageId: command.messageId,
            generationId,
            status: 'generating',
          },
        };
      }
      case 'walkthrough/cancel': {
        const cancelNow = new Date().toISOString();
        const cancelledArtifact: WalkthroughArtifact = {
          version: 1,
          id: `wt-${command.messageId}`,
          sessionId: command.sessionId,
          messageId: command.messageId,
          mode: 'default',
          sourceHash: 'mock-source-hash',
          createdAt: cancelNow,
          updatedAt: cancelNow,
          status: 'error',
          error: { code: 'cancelled', message: 'Walkthrough generation was cancelled.' },
          generatedAt: cancelNow,
        };
        this.emitPush({
          type: 'walkthrough/updated',
          sessionId: command.sessionId,
          artifact: cancelledArtifact,
        });
        return {
          id,
          type: 'response',
          command: 'walkthrough/cancel',
          success: true,
          data: {
            sessionId: command.sessionId,
            messageId: command.messageId,
            ...(command.generationId !== undefined ? { generationId: command.generationId } : {}),
            status: 'cancelled',
          },
        };
      }

      default:
        return {
          id,
          type: 'response',
          command: command.type,
          success: false,
          error: `mock client does not implement ${command.type}`,
        };
    }
  }

  private createMockMediaAsset(input: {
    sessionId: string;
    mimeType: string;
    name?: string;
    contentKind?: string;
    byteSize?: number;
    base64Data?: string;
  }): {
    id: string;
    sessionId: string;
    absolutePath: string;
    mimeType: string;
    byteSize: number;
    createdAt: string;
    name?: string;
    contentKind?: string;
  } {
    const extension =
      input.name?.match(/\.[a-z0-9]{1,12}$/iu)?.[0].toLowerCase() ??
      (input.mimeType.split('/')[1]?.replace(/[^a-z0-9]/giu, '') || 'bin');
    const asset = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      absolutePath: `/tmp/piwin-mock-media/${input.sessionId}/${crypto.randomUUID()}${extension.startsWith('.') ? extension : `.${extension}`}`,
      mimeType: input.mimeType,
      byteSize:
        input.byteSize ??
        Math.max(1, Math.floor((input.base64Data?.length ?? 4) * 0.75)),
      createdAt: new Date().toISOString(),
    };
    return {
      ...asset,
      ...(input.name ? { name: input.name } : {}),
      ...(input.contentKind ? { contentKind: input.contentKind } : {}),
    };
  }

  private copyMockAssemblySummaries(
    sourceSessionId: string,
    targetSessionId: string,
    messageIdMap: ReadonlyMap<string, string>,
    retainedRunIds?: ReadonlySet<string>,
  ): void {
    const source = this.mockAssemblySummaries.get(sourceSessionId) ?? [];
    if (source.length === 0) {
      return;
    }
    const copied: ContextSummaryPush[] = [];
    for (const summary of source) {
      const mappedUser = summary.userMessageId
        ? messageIdMap.get(summary.userMessageId)
        : undefined;
      const keepByUser = summary.userMessageId !== undefined && messageIdMap.has(summary.userMessageId);
      const keepByRun = retainedRunIds === undefined || retainedRunIds.has(summary.runId);
      if (retainedRunIds !== undefined && !keepByUser && !keepByRun) {
        continue;
      }
      copied.push({
        ...summary,
        sessionId: targetSessionId,
        ...(mappedUser === undefined ? {} : { userMessageId: mappedUser }),
      });
    }
    this.mockAssemblySummaries.set(targetSessionId, copied);
    this.mockAssemblyOrdinals.set(
      targetSessionId,
      copied.reduce((max, item) => Math.max(max, item.requestOrdinal), 0),
    );
  }

  private emitMockAssemblySummary(input: {
    sessionId: string;
    runId: string;
    requestClass: ContextSummaryPush['requestClass'];
    userMessageId?: string;
    text: string;
    attachments?: PromptInput['attachments'];
  }): void {
    const requestOrdinal = (this.mockAssemblyOrdinals.get(input.sessionId) ?? 0) + 1;
    this.mockAssemblyOrdinals.set(input.sessionId, requestOrdinal);
    const contributions: ContextSummaryPush['contributions'] = [
      {
        id: crypto.randomUUID(),
        kind: input.requestClass === 'steer' ? 'user' : 'user',
        label: input.requestClass === 'steer' ? 'Steer' : 'User',
        trustOrigin: 'user',
        canOpenOnClient: false,
        redactionState: 'none',
        estimatedTokens: estimateHostTokens(input.text),
        preview: input.text.slice(0, 200),
      },
    ];
    for (const attachment of input.attachments ?? []) {
      if (attachment.kind !== 'media') {
        continue;
      }
      contributions.push({
        id: crypto.randomUUID(),
        kind: attachment.mimeType.toLowerCase().startsWith('image/')
          ? 'native-image'
          : 'attachment-text',
        label: attachment.mimeType,
        trustOrigin: 'user',
        canOpenOnClient: false,
        redactionState: 'path',
        displayPath: attachment.path.split(/[/\\]/).pop() ?? attachment.path,
      });
    }
    const totalEstimatedTokens = contributions.reduce(
      (sum, item) => sum + (item.estimatedTokens ?? 0),
      0,
    );
    const summary: ContextSummaryPush = {
      type: 'agent/context-summary',
      sessionId: input.sessionId,
      runId: input.runId,
      requestClass: input.requestClass,
      requestOrdinal,
      coverage: 'assembly-only',
      estimateSource: 'host-estimate',
      contributions,
      ...(input.userMessageId ? { userMessageId: input.userMessageId } : {}),
      ...(totalEstimatedTokens > 0 ? { totalEstimatedTokens } : {}),
    };
    const existing = this.mockAssemblySummaries.get(input.sessionId) ?? [];
    this.mockAssemblySummaries.set(input.sessionId, [...existing, summary]);
    this.emitPush(summary);
  }

  private mockQueueRevision(sessionId: string): number {
    return this.mockQueueRevisions.get(sessionId) ?? 0;
  }

  private bumpMockQueueRevision(sessionId: string): number {
    const next = this.mockQueueRevision(sessionId) + 1;
    this.mockQueueRevisions.set(sessionId, next);
    return next;
  }

  private emitMockQueuedTurn(queuedTurn: QueuedTurnRecord): void {
    this.emitPush({ type: 'session/queued-turn-updated', queuedTurn });
  }

  private async handleMockQueuedTurnSubmit(
    command: Extract<HostCommand, { type: 'session/queued-turn-submit' }>,
    id: string,
  ): Promise<HostResponse> {
    const session = this.sessions.get(command.sessionId);
    if (!session) {
      return { id, type: 'response', command: command.type, success: false, error: 'unknown session' };
    }
    const existing = this.mockQueuedTurns
      .get(command.sessionId)
      ?.find((item) => item.queuedTurnId === command.queuedTurnId);
    const normalizedInput: PromptInput = {
      ...command.input,
      clientMessageId: command.userMessageId,
    };
    if (existing) {
      if (mockQueuedInputFingerprint(existing.input) !== mockQueuedInputFingerprint(normalizedInput)) {
        return {
          id,
          type: 'response',
          command: command.type,
          success: false,
          error: 'queued-turn-idempotency-conflict',
        };
      }
      return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: existing } };
    }
    const inputError = validateMockQueuedTurnInput(command.input);
    if (inputError) {
      return { id, type: 'response', command: command.type, success: false, error: inputError };
    }
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const pending = queue.filter((item) => item.status === 'pending' || item.status === 'starting');
    if (pending.length >= QUEUED_TURN_MAX_PENDING_PER_SESSION) {
      return {
        id,
        type: 'response',
        command: command.type,
        success: false,
        error: 'queued-turn-queue-full',
      };
    }
    const pendingBytes = pending.reduce((total, item) => total + byteLength(item.input.text), 0);
    if (pendingBytes + byteLength(command.input.text) > QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION) {
      return {
        id,
        type: 'response',
        command: command.type,
        success: false,
        error: 'queued-turn-queue-full',
      };
    }
    const now = new Date().toISOString();
    const queuedTurn: QueuedTurnRecord = {
      queuedTurnId: command.queuedTurnId,
      revision: 1,
      sessionId: command.sessionId,
      sequence: queue.length + 1,
      userMessageId: command.userMessageId,
      mode: 'next',
      status: 'pending',
      input: normalizedInput,
      submittedAt: now,
      updatedAt: now,
    };
    queue.push(queuedTurn);
    this.mockQueuedTurns.set(command.sessionId, queue);
    this.bumpMockQueueRevision(command.sessionId);
    const message: SessionTranscriptMessage = {
      id: queuedTurn.userMessageId,
      role: 'user',
      text: queuedTurn.input.text,
      createdAt: now,
      status: 'done',
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: queuedTurn.queuedTurnId,
        status: queuedTurn.status,
        revision: queuedTurn.revision,
      },
    };
    if (queuedTurn.input.attachments) {
      const media = queuedTurn.input.attachments.filter(
        (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
      );
      if (media.length > 0) message.attachments = media;
    }
    if (queuedTurn.input.contextRefs) message.contextRefs = queuedTurn.input.contextRefs;
    appendMockTranscriptMessage(session, message);
    this.emitPush({ type: 'transcript/append', sessionId: command.sessionId, message });
    this.emitMockQueuedTurn(queuedTurn);
    void this.drainMockQueue(command.sessionId);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn } };
  }

  private async handleMockQueuedTurnList(
    command: Extract<HostCommand, { type: 'session/queued-turn-list' }>,
    id: string,
  ): Promise<HostResponse> {
    const queuedTurns = [...(this.mockQueuedTurns.get(command.sessionId) ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
    return {
      id,
      type: 'response',
      command: command.type,
      success: true,
      data: { queueRevision: this.mockQueueRevision(command.sessionId), queuedTurns },
    };
  }

  private async handleMockQueuedTurnEdit(
    command: Extract<HostCommand, { type: 'session/queued-turn-edit' }>,
    id: string,
  ): Promise<HostResponse> {
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const index = queue.findIndex((item) => item.queuedTurnId === command.queuedTurnId);
    const current = queue[index];
    if (!current || current.status !== 'pending' || current.revision !== command.expectedRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const updated: QueuedTurnRecord = {
      ...current,
      revision: current.revision + 1,
      input: { ...command.input, clientMessageId: current.userMessageId },
      updatedAt: new Date().toISOString(),
    };
    queue[index] = updated;
    this.bumpMockQueueRevision(command.sessionId);
    this.updateMockQueuedTranscript(command.sessionId, updated);
    this.emitMockQueuedTurn(updated);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: updated } };
  }

  private async handleMockQueuedTurnCancel(
    command: Extract<HostCommand, { type: 'session/queued-turn-cancel' }>,
    id: string,
  ): Promise<HostResponse> {
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const index = queue.findIndex((item) => item.queuedTurnId === command.queuedTurnId);
    const current = queue[index];
    if (!current || current.status !== 'pending' || current.revision !== command.expectedRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const cancelled: QueuedTurnRecord = {
      ...current,
      revision: current.revision + 1,
      status: 'cancelled',
      terminalReason: 'user-cancelled',
      updatedAt: new Date().toISOString(),
    };
    queue[index] = cancelled;
    this.bumpMockQueueRevision(command.sessionId);
    this.updateMockQueuedTranscript(command.sessionId, cancelled);
    this.emitMockQueuedTurn(cancelled);
    return { id, type: 'response', command: command.type, success: true, data: { queuedTurn: cancelled } };
  }

  private async handleMockQueuedTurnReorder(
    command: Extract<HostCommand, { type: 'session/queued-turn-reorder' }>,
    id: string,
  ): Promise<HostResponse> {
    if (this.mockQueueRevision(command.sessionId) !== command.expectedQueueRevision) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-revision-conflict' };
    }
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const pending = queue.filter((item) => item.status === 'pending');
    if (
      pending.length !== command.orderedQueuedTurnIds.length ||
      new Set(command.orderedQueuedTurnIds).size !== pending.length ||
      command.orderedQueuedTurnIds.some((queuedTurnId) => !pending.some((item) => item.queuedTurnId === queuedTurnId))
    ) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-reorder-invalid' };
    }
    const firstSequence = queue.reduce(
      (maximum, item) => Math.max(maximum, item.sequence),
      0,
    ) + 1;
    command.orderedQueuedTurnIds.forEach((queuedTurnId, index) => {
      const item = queue.find((candidate) => candidate.queuedTurnId === queuedTurnId);
      if (item) {
        item.sequence = firstSequence + index;
        item.revision += 1;
        this.updateMockQueuedTranscript(command.sessionId, item);
        this.emitMockQueuedTurn(item);
      }
    });
    const revision = this.bumpMockQueueRevision(command.sessionId);
    return { id, type: 'response', command: command.type, success: true, data: { queueRevision: revision, queuedTurns: queue } };
  }

  private async handleMockReplaceRun(
    command: Extract<HostCommand, { type: 'session/replace-run' }>,
    id: string,
  ): Promise<HostResponse> {
    const activeRunId = this.mockActiveRunIds.get(command.sessionId);
    if (!activeRunId) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-no-active-run' };
    }
    if (activeRunId !== command.runId) {
      return { id, type: 'response', command: command.type, success: false, error: 'queued-turn-run-mismatch' };
    }
    const response = await this.handle(
      {
        type: 'session/queued-turn-submit',
        sessionId: command.sessionId,
        queuedTurnId: command.queuedTurnId,
        userMessageId: command.userMessageId,
        input: command.input,
      },
      id,
    );
    if (!response.success) return response;
    const queue = this.mockQueuedTurns.get(command.sessionId) ?? [];
    const item = queue.find((candidate) => candidate.queuedTurnId === command.queuedTurnId);
    if (item) {
      item.mode = 'replace';
      item.replaceRunId = command.runId;
      item.revision += 1;
      this.bumpMockQueueRevision(command.sessionId);
      this.updateMockQueuedTranscript(command.sessionId, item);
      this.emitMockQueuedTurn(item);
    }
    this.pushMockRunUpdated(command.sessionId, command.runId, 'cancelling', 'cancelling');
    this.mockPromptAborts.get(command.sessionId)?.abort();
    return {
      ...response,
      ...(response.success && item
        ? { data: { ...(response.data ?? {}), queuedTurn: item } }
        : {}),
    };
  }

  private updateMockQueuedTranscript(sessionId: string, queuedTurn: QueuedTurnRecord): void {
    const session = this.sessions.get(sessionId);
    const message = session?.transcript.find((item) => item.id === queuedTurn.userMessageId);
    if (!message) return;
    message.text = queuedTurn.input.text;
    if (queuedTurn.startedRunId === undefined) {
      delete message.runId;
    } else {
      message.runId = queuedTurn.startedRunId;
    }
    message.instructionDelivery = {
      kind: 'queued-turn',
      instructionId: queuedTurn.queuedTurnId,
      status: queuedTurn.status,
      ...(queuedTurn.startedRunId ?? queuedTurn.replaceRunId
        ? { targetRunId: queuedTurn.startedRunId ?? queuedTurn.replaceRunId }
        : {}),
      revision: queuedTurn.revision,
    };
  }

  private async drainMockQueue(sessionId: string): Promise<void> {
    if (this.mockActiveRunIds.has(sessionId)) return;
    const queue = this.mockQueuedTurns.get(sessionId) ?? [];
    const next = [...queue]
      .sort((left, right) => left.sequence - right.sequence)
      .find((item) => item.status === 'pending');
    if (!next) return;
    if (next.mode === 'replace' && next.replaceRunId) {
      const oldRun = this.mockRuns.get(next.replaceRunId);
      if (!oldRun || !isRunTerminal(oldRun.status)) return;
    }
    next.status = 'starting';
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    this.bumpMockQueueRevision(sessionId);
    this.updateMockQueuedTranscript(sessionId, next);
    this.emitMockQueuedTurn(next);
    const response = await this.handle(
      {
        type: 'session/prompt',
        sessionId,
        admission: 'queued-turn',
        input: { ...next.input, source: 'queued-turn', clientMessageId: next.userMessageId },
      },
      `queued-${next.queuedTurnId}`,
    );
    if (!response.success) {
      next.status = 'failed';
      next.revision += 1;
      next.terminalReason = 'prompt-rejected';
      next.updatedAt = new Date().toISOString();
      this.bumpMockQueueRevision(sessionId);
      this.updateMockQueuedTranscript(sessionId, next);
      this.emitMockQueuedTurn(next);
      return;
    }
    const runId = (response.data as { runId?: unknown } | undefined)?.runId;
    if (typeof runId !== 'string') return;
    next.status = 'started';
    next.startedRunId = runId;
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    this.bumpMockQueueRevision(sessionId);
    this.updateMockQueuedTranscript(sessionId, next);
    this.emitMockQueuedTurn(next);
  }

  private async emitMockPrompt(sessionId: string, text: string, runId: string): Promise<void> {
    const existing = this.mockPromptAborts.get(sessionId);
    existing?.abort();
    const controller = new AbortController();
    this.mockPromptAborts.set(sessionId, controller);

    const assistantId = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const session = this.sessions.get(sessionId);
    const isRendererStressPrompt = text.includes('__PIWIN_RENDER_STRESS__');
    if (isRendererStressPrompt && session) {
      for (let historyIndex = 0; historyIndex < 500; historyIndex += 1) {
        const historyMessage: SessionTranscriptMessage = {
          id: crypto.randomUUID(),
          role: historyIndex % 2 === 0 ? 'user' : 'assistant',
          text: `renderer stress history message ${historyIndex}`,
          createdAt: new Date().toISOString(),
          status: 'done',
        };
        appendMockTranscriptMessage(session, historyMessage);
        this.emitPush({
          type: 'transcript/append',
          sessionId,
          message: historyMessage,
        });
      }
    }
    const wantsAbortWindow =
      !isRendererStressPrompt &&
      (/abort|mid way|fairly long reply/i.test(text) || text.length > 120);
    const reply = isRendererStressPrompt
      ? `renderer stress stream\n${'x'.repeat(100_000)}`
      : wantsAbortWindow
        ? `piwin desktop mock reply.\nYou said: ${text}\n${'chunk '.repeat(80)}`
        : `piwin desktop mock reply.\nYou said: ${text}`;
    this.pushMockRunUpdated(sessionId, runId, 'running', 'waiting-first-token');
    this.pushEvent(sessionId, {
      type: 'message/start',
      messageId: assistantId,
      role: 'assistant',
      runId,
    });
    this.pushEvent(sessionId, {
      type: 'tool/start',
      toolCallId: toolId,
      toolName: 'mock_echo',
      runId,
    });
    this.pushEvent(sessionId, { type: 'tool/end', toolCallId: toolId, isError: false, runId });
    this.pushMockRunUpdated(sessionId, runId, 'running', 'streaming');

    let assembled = '';
    try {
      for (const chunk of chunkText(reply, 28)) {
        if (controller.signal.aborted) {
          if (session) {
            appendMockTranscriptMessage(session, {
              id: assistantId,
              role: 'assistant',
              text: assembled,
              createdAt: new Date().toISOString(),
              status: 'done',
            });
          }
          this.pushEvent(sessionId, {
            type: 'session/aborted',
            sessionId,
            messageId: assistantId,
            runId,
          });
          const paused = this.mockPauseRequested.delete(sessionId);
          this.emitMockTerminal(
            sessionId,
            runId,
            paused ? 'interrupted' : 'cancelled',
            paused ? 'paused' : 'cancelled',
            paused ? this.mockPauseCheckpointIds.get(sessionId) : undefined,
          );
          return;
        }
        assembled += chunk;
        this.pushEvent(sessionId, {
          type: 'message/text_delta',
          messageId: assistantId,
          delta: chunk,
          runId,
        });
        // Keep the renderer stress fixture in streaming state until Stop is
        // pressed. This makes the cancellation test independent of timer
        // speed and prevents a natural completion from racing the click.
        if (isRendererStressPrompt && assembled.length === chunk.length) {
          await waitForMockAbort(controller.signal);
        }
        await delay(isRendererStressPrompt ? 1 : wantsAbortWindow ? 35 : 12);
      }

      if (controller.signal.aborted) {
        if (session) {
          appendMockTranscriptMessage(session, {
            id: assistantId,
            role: 'assistant',
            text: assembled,
            createdAt: new Date().toISOString(),
            status: 'done',
          });
        }
        this.pushEvent(sessionId, {
          type: 'session/aborted',
          sessionId,
          messageId: assistantId,
          runId,
        });
        const paused = this.mockPauseRequested.delete(sessionId);
        this.emitMockTerminal(
          sessionId,
          runId,
          paused ? 'interrupted' : 'cancelled',
          paused ? 'paused' : 'cancelled',
          paused ? this.mockPauseCheckpointIds.get(sessionId) : undefined,
        );
        return;
      }

      if (session) {
        appendMockTranscriptMessage(session, {
          id: assistantId,
          role: 'assistant',
          text: reply,
          createdAt: new Date().toISOString(),
          status: 'done',
        });
      }
      this.pushEvent(sessionId, { type: 'message/end', messageId: assistantId, runId });
      this.emitMockTerminal(sessionId, runId, 'completed');
      // Mirror host auto-naming: name after the first completed exchange unless
      // the user has manually renamed the session.
      this.maybeMockAutoName(sessionId);
    } finally {
      if (this.mockPromptAborts.get(sessionId) === controller) {
        this.mockPromptAborts.delete(sessionId);
      }
    }
  }

  private emitMockTerminal(
    sessionId: string,
    runId: string,
    outcome: 'completed' | 'cancelled' | 'failed' | 'interrupted',
    code?: 'cancelled' | 'paused',
    resumeCheckpointId?: string,
  ): void {
    if (this.mockTerminalRunIds.has(runId)) {
      return;
    }
    this.mockTerminalRunIds.add(runId);
    if (this.mockActiveRunIds.get(sessionId) === runId) {
      this.mockActiveRunIds.delete(sessionId);
    }
    const existing = this.mockRuns.get(runId);
    const terminalRun: ExecutionRunRecord = {
      ...(existing ?? {
        runId,
        kind: 'session-turn' as const,
        rootRunId: runId,
        sessionId,
      }),
      status: outcome,
      endedAt: new Date().toISOString(),
      ...(code ? { terminalCode: code } : {}),
      ...(resumeCheckpointId ? { resumeCheckpointId } : {}),
    };
    this.mockRuns.set(runId, terminalRun);
    if (
      outcome === 'completed' ||
      (outcome === 'cancelled' && (resumeCheckpointId ?? existing?.resumeCheckpointId))
    ) {
      this.mockPauseCheckpointIds.delete(sessionId);
    }
    this.emitPush({ type: 'run/updated', run: terminalRun });
    this.emitPush({ type: 'run/terminal', run: terminalRun });
    // Preserve the Host terminal barrier: only request the next-turn drain
    // after the terminal projection has entered the client stream.
    void this.drainMockQueue(sessionId);
  }

  private pushMockRunUpdated(
    sessionId: string,
    runId: string,
    status: ExecutionRunRecord['status'],
    phase: import('@piwin/contracts').SessionRunPhase,
    at = new Date().toISOString(),
    resumeCheckpointId?: string,
  ): void {
    const existing = this.mockRuns.get(runId);
    const run: ExecutionRunRecord = {
      ...(existing ?? {
        runId,
        kind: 'session-turn' as const,
        rootRunId: runId,
        sessionId,
        firstTokenReceived: false,
      }),
      status,
      phase,
      phaseUpdatedAt: at,
      ...(resumeCheckpointId ? { resumeCheckpointId } : {}),
      ...(existing?.startedAt ? {} : { startedAt: at }),
    };
    this.mockRuns.set(runId, run);
    this.emitPush({ type: 'run/updated', run });
  }

  /**
   * Mock-only auto-naming so browser e2e sees the same `session/name-updated`
   * push as the real host. Names only default/auto sessions, never user-set.
   */
  private maybeMockAutoName(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    // Terminal sources; also skip if we already wrote a text name.
    if (
      session.nameSource === 'user' ||
      session.nameSource === 'llm' ||
      session.nameSource === 'text'
    ) {
      return;
    }
    const firstUser = session.transcript.find((message) => message.role === 'user');
    const name = firstUser?.text ? deriveDefaultNameFromMessage(firstUser.text) : '';
    if (!name) {
      return;
    }
    session.name = name;
    session.nameSource = 'text';
    this.emitPush({
      type: 'session/name-updated',
      sessionId,
      name,
      nameSource: 'text',
    });
  }

  private pushEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.events.push(event);
    }
    this.emitPush({ type: 'event', sessionId, event });
  }
}

function createMockUsageRollup(projectPath: string | undefined): UsageRollup {
  const day = (offset: number): string => {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  };
  const byDay: Record<string, UsageBucket> = {
    [day(12)]: usageBucket(15_000, 5_000, 20_000, 4_000, 6),
    [day(10)]: usageBucket(20_000, 6_000, 24_000, 2_000, 8),
    [day(8)]: usageBucket(12_000, 4_000, 18_000, 2_000, 5),
    [day(6)]: usageBucket(25_000, 8_000, 31_000, 4_000, 10),
    [day(4)]: usageBucket(28_000, 7_000, 35_000, 4_000, 12),
    [day(2)]: usageBucket(21_000, 7_000, 30_000, 3_000, 9),
    [day(0)]: usageBucket(36_000, 7_000, 40_000, 6_000, 16),
  };
  return {
    scope: projectPath ? { kind: 'project', projectPath } : { kind: 'global' },
    promptTokens: 157_000,
    completionTokens: 44_000,
    cacheReadTokens: 198_000,
    cacheWriteTokens: 25_000,
    totalTokens: 424_000,
    entryCount: 66,
    sessionCount: 12,
    firstAt: `${day(12)}T08:00:00.000Z`,
    lastAt: `${day(0)}T12:00:00.000Z`,
    byModel: {
      'gpt-5.2-codex': usageBucket(122_000, 30_000, 156_000, 20_000, 50),
      'claude-sonnet-4-5': usageBucket(35_000, 14_000, 42_000, 5_000, 16),
    },
    byModelKey: [
      {
        providerId: 'openai-work',
        modelId: 'gpt-5.2-codex',
        ...usageBucket(78_000, 18_000, 132_000, 12_000, 32),
      },
      {
        providerId: 'anthropic-main',
        modelId: 'claude-sonnet-4-5',
        ...usageBucket(35_000, 14_000, 42_000, 5_000, 16),
      },
      {
        providerId: 'openai-personal',
        modelId: 'gpt-5.2-codex',
        ...usageBucket(44_000, 12_000, 24_000, 8_000, 18),
      },
    ],
    byDay,
    bySession: [],
  };
}

function usageBucket(
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  entryCount: number,
): UsageBucket {
  return {
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
    entryCount,
  };
}

function mockSessionMessageResponse(
  sessionId: string,
  messages: readonly SessionTranscriptMessage[],
  projection: import('@piwin/contracts').SessionMessageProjection | undefined,
): {
  messages?: SessionTranscriptMessage[];
  transcriptPage?: import('@piwin/contracts').SessionTranscriptPageInfo;
} {
  if (projection === 'none') return {};
  if (projection !== 'tail') return { messages: [...messages] };
  const page = createMockSessionTranscriptPage(messages, {
    sessionId,
    limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
    maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  });
  if (page.status !== 'page') {
    throw new Error('Mock cursorless mutation projection unexpectedly returned stale');
  }
  return { messages: page.messages, transcriptPage: page.page };
}

type MockSessionPageCursor = {
  revision: string;
  offset: number;
  limit: number;
};

function compareMockSessionSummaries(
  left: SessionSummary,
  right: SessionSummary,
  order: import('@piwin/contracts').SessionListOrder,
): number {
  if (order === 'alphabetical') {
    const byName = (left.name ?? '').localeCompare(right.name ?? '');
    return byName !== 0 ? byName : left.id.localeCompare(right.id);
  }
  const leftPinned = left.isPinned === true;
  const rightPinned = right.isPinned === true;
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  if (leftPinned && rightPinned) {
    const byPinnedAt = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '');
    if (byPinnedAt !== 0) return byPinnedAt;
  }
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
}

function mockSessionPageRevision(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

function formatMockSessionPageCursor(cursor: MockSessionPageCursor): string {
  return `mock_${cursor.revision}_${cursor.offset}_${cursor.limit}`;
}

function parseMockSessionPageCursor(value: string): MockSessionPageCursor | null {
  const match = /^mock_([a-f0-9]{64})_(\d+)_(\d+)$/.exec(value);
  if (!match) return null;
  const revision = match[1];
  const rawOffset = match[2];
  const rawLimit = match[3];
  if (revision === undefined || rawOffset === undefined || rawLimit === undefined) return null;
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
    return null;
  }
  return { revision, offset, limit };
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForMockAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

function mockQueuedInputFingerprint(input: PromptInput): string {
  return JSON.stringify(input, Object.keys(input).sort());
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function validateMockQueuedTurnInput(input: PromptInput): string | undefined {
  const hasText = input.text.trim().length > 0;
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const hasContext = (input.contextRefs?.length ?? 0) > 0;
  if (!hasText && !hasAttachments && !hasContext) {
    return 'queued-turn-empty: text, attachment, or context is required';
  }
  if (byteLength(input.text) > QUEUED_TURN_MAX_TEXT_BYTES) {
    return 'queued-turn-bounds-exceeded: text exceeds 64 KiB';
  }
  if (input.source === 'resume' || input.resumeCheckpointId !== undefined) {
    return 'queued-turn-input-invalid: resume prompts cannot be queued';
  }
  return undefined;
}
