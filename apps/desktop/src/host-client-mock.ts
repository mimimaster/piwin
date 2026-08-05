import { isPlaceholderSessionName } from './title-display';
/** Browser mock host backend — isolated from live Tauri transport. */
import type {
  AgentEvent,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostServerMessage,
  MediaAttachmentRef,
  ModelRef,
  SessionSummary,
  SessionTranscriptMessage,
  WalkthroughArtifact,
} from '@piwin/contracts';

export type MockEmit = (message: HostPush | HostServerMessage) => void;

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
      name?: string;
      nameSource?: 'default' | 'text' | 'llm' | 'user';
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
    }
  >();
  private plans = new Map<string, import('@piwin/contracts').SessionPlan>();
  private childIndex = new Map<string, import('@piwin/contracts').SessionSummary[]>();
  /** Mock-only: extension ids disabled via extensions/set_enabled. */
  private mockDisabledExtensionIds = new Set<string>();
  private mockBundledExtensionsInstalled = true;
  private mockDisabledPromptIds = new Set<string>();
  private mockActiveThemeId: 'piwin-dark' | 'piwin-light' | 'piwin-orange-white' = 'piwin-dark';
  private mockProcesses = new Map<string, import('@piwin/contracts').ManagedProcessRecord>();
  private mockProcessLogs = new Map<string, string>();
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
  /** Mock browser session current URL (null = stopped). */
  private mockBrowserUrl: string | null = null;
  /** ADR 0015: the run currently owning each session's foreground turn. */
  private mockActiveRunIds = new Map<string, string>();
  /** Guards the exactly-once terminal transition for each mock run. */
  private mockTerminalRunIds = new Set<string>();
  private mockConfig: import('@piwin/contracts').PiwinConfig = {
    hostMode: 'sdk',
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    artifact: { enabled: true, triggerMode: 'automatic', decisionPrompt: { mode: 'default', customPrompt: '' }, maxBytes: 100 * 1024 },
  };
  /** Monotonic revision for the in-memory settings snapshot (mock parity). */
  private mockSettingsRevision = 'mock-settings-v1';

  constructor(emitPush: MockEmit, getMode: () => HostMode) {
    this.emitPush = emitPush;
    this.getMode = getMode;
  }

  private emitParentSubagentActivity(input: {
    parentSessionId: string;
    childSessionId: string;
    displayName: string;
    task: string;
    state: 'started' | 'running' | 'completed' | 'failed' | 'cancelled' | 'merged';
  }): void {
    const parent = this.sessions.get(input.parentSessionId);
    if (!parent) {
      return;
    }
    const updatedAt = new Date().toISOString();
    const activity = {
      childSessionId: input.childSessionId,
      displayName: input.displayName,
      taskSummary: input.task,
      state: input.state,
      updatedAt,
    };
    const message: SessionTranscriptMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      text: `Subagent ${input.state}: ${input.displayName}
Task: ${input.task}\nchildSessionId=${input.childSessionId}`,
      createdAt: updatedAt,
      status: 'done',
      subagentActivity: activity,
    };
    parent.transcript.push(message);
    this.emitPush({
      type: 'transcript/append',
      sessionId: input.parentSessionId,
      message,
    });
  }

  clear(): void {
    this.sessions.clear();
    this.plans.clear();
    this.childIndex.clear();
    this.mockProcesses.clear();
    this.mockProcessLogs.clear();
    this.mockPtys.clear();
    this.mockRememberedPermissions.clear();
    this.mockPromptAborts.clear();
    this.mockActiveRunIds.clear();
    this.mockTerminalRunIds.clear();
  }

  private mockSessionSummary(
    sessionId: string,
    session: {
      projectPath: string;
      scope?: import('@piwin/contracts').SessionScope;
      workingDirectory?: string;
      events: AgentEvent[];
      transcript: SessionTranscriptMessage[];
      name?: string;
      isPinned?: boolean;
      pinnedAt?: string;
      isArchived?: boolean;
      archivedAt?: string;
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
      updatedAt: new Date().toISOString(),
      messageCount: session.transcript.length || session.events.length,
      name: session.name ?? `session-${sessionId.slice(0, 8)}`,
    };
    if (session.isPinned === true) summary.isPinned = true;
    if (session.pinnedAt) summary.pinnedAt = session.pinnedAt;
    if (session.isArchived === true) summary.isArchived = true;
    if (session.archivedAt) summary.archivedAt = session.archivedAt;
    return summary;
  }

  async handle(command: HostCommand, id: string): Promise<HostResponse> {
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
              usage: true,
              pty: false,
              shellPreview: true,
              subagentWorktree: true,
              marketplaceHub: true,
              automation: true,
            },
          },
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
        const sessions: SessionSummary[] = [...this.sessions.entries()]
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
              updatedAt: new Date().toISOString(),
              messageCount: value.transcript.length || value.events.length,
            };
            if (value.name) summary.name = value.name;
            if (value.nameSource) summary.nameSource = value.nameSource;
            if (value.isPinned === true) summary.isPinned = true;
            if (value.pinnedAt) summary.pinnedAt = value.pinnedAt;
            if (value.isArchived === true) summary.isArchived = true;
            if (value.archivedAt) summary.archivedAt = value.archivedAt;
            return summary;
          })
          .filter((session) => {
            if (isPlaceholderSessionName(session.name)) {
              return false;
            }
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
            if (includeArchived) {
              return true;
            }
            return session.isArchived !== true;
          });
        return { id, type: 'response', command: 'session/list', success: true, data: { sessions } };
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
        if (!session) {
          session = { projectPath: '/mock/project', events: [], transcript: [] };
          this.sessions.set(command.sessionId, session);
        }
        return {
          id,
          type: 'response',
          command: 'session/resume',
          success: true,
          data: {
            sessionId: command.sessionId,
            live: true,
            messages: session.transcript,
            projectPath: session.projectPath,
          },
        };
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
            messages: session?.transcript ?? [],
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
        const now = new Date().toISOString();
        const runId = crypto.randomUUID();
        this.mockActiveRunIds.set(command.sessionId, runId);
        this.pushEvent(command.sessionId, {
          type: 'run/phase',
          sessionId: command.sessionId,
          runId,
          phase: 'accepted',
          at: now,
        });
        this.pushEvent(command.sessionId, {
          type: 'run/phase',
          sessionId: command.sessionId,
          runId,
          phase: 'preparing',
          at: new Date().toISOString(),
        });
        const userMessage: SessionTranscriptMessage = {
          id: crypto.randomUUID(),
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
        session.transcript.push(userMessage);
        // Immediate text name (matches host recordUserPrompt naming pipeline).
        this.maybeMockAutoName(command.sessionId);
        const attachmentNote =
          command.input.attachments && command.input.attachments.length > 0
            ? `\n[attachments: ${command.input.attachments
                .filter((item): item is MediaAttachmentRef => item.kind === 'media')
                .map((item) => item.path)
                .join(', ')}]`
            : '';
        // Stream asynchronously so concurrent session/abort can cancel mid-turn.
        void this.emitMockPrompt(
          command.sessionId,
          `${command.input.text}${attachmentNote}`,
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
      case 'session/abort': {
        const activeRunId = this.mockActiveRunIds.get(command.sessionId);
        if (!activeRunId) {
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
        this.pushEvent(command.sessionId, {
          type: 'run/phase',
          sessionId: command.sessionId,
          runId: activeRunId,
          phase: 'cancelling',
          at: new Date().toISOString(),
        });
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

      case 'session/spawn': {
        const parent = this.sessions.get(command.parentSessionId);
        if (!parent) {
          return {
            id,
            type: 'response',
            command: 'session/spawn',
            success: false,
            error: `unknown parent ${command.parentSessionId}`,
          };
        }
        const childId = crypto.randomUUID();
        this.sessions.set(childId, {
          projectPath: parent.projectPath,
          scope:
            parent.scope ??
            (parent.projectPath
              ? { kind: 'project', projectPath: parent.projectPath }
              : { kind: 'general' }),
          workingDirectory: parent.workingDirectory ?? parent.projectPath,
          events: [],
          transcript: [],
        });
        const childMeta = {
          id: childId,
          scope:
            parent.scope ??
            (parent.projectPath
              ? { kind: 'project' as const, projectPath: parent.projectPath }
              : { kind: 'general' as const }),
          workingDirectory: parent.workingDirectory ?? parent.projectPath ?? 'general',
          projectPath: parent.projectPath,
          name: `subagent-${command.task.slice(0, 24)}`,
          updatedAt: new Date().toISOString(),
          messageCount: 0,
          parentSessionId: command.parentSessionId,
          depth: 1,
          kind: 'subagent' as const,
          subagentStatus: 'running' as const,
          task: command.task,
        };
        if (!this.childIndex) {
          this.childIndex = new Map();
        }
        const list = this.childIndex.get(command.parentSessionId) ?? [];
        list.unshift(childMeta);
        this.childIndex.set(command.parentSessionId, list);
        this.emitParentSubagentActivity({
          parentSessionId: command.parentSessionId,
          childSessionId: childId,
          displayName: childMeta.name,
          task: command.task,
          state: 'running',
        });
        return {
          id,
          type: 'response',
          command: 'session/spawn',
          success: true,
          data: { sessionId: childId, parentSessionId: command.parentSessionId },
        };
      }
      case 'session/list-children': {
        const sessions = this.childIndex?.get(command.parentSessionId) ?? [];
        return {
          id,
          type: 'response',
          command: 'session/list-children',
          success: true,
          data: { parentSessionId: command.parentSessionId, sessions },
        };
      }
      case 'session/cancel-subagent': {
        if (this.childIndex) {
          for (const [parentId, list] of this.childIndex.entries()) {
            const next = list.map((item) =>
              item.id === command.sessionId
                ? { ...item, subagentStatus: 'cancelled' as const }
                : item,
            );
            this.childIndex.set(parentId, next);
          }
        }
        if (this.childIndex) {
          for (const [parentId, list] of this.childIndex.entries()) {
            const child = list.find((item) => item.id === command.sessionId);
            if (child) {
              this.emitParentSubagentActivity({
                parentSessionId: parentId,
                childSessionId: child.id,
                displayName: child.name ?? child.id,
                task: child.task ?? '',
                state: 'cancelled',
              });
            }
          }
        }
        return {
          id,
          type: 'response',
          command: 'session/cancel-subagent',
          success: true,
          data: { sessionId: command.sessionId, status: 'cancelled' },
        };
      }
      case 'session/complete-subagent': {
        if (this.childIndex) {
          for (const [parentId, list] of this.childIndex.entries()) {
            const next = list.map((item) =>
              item.id === command.sessionId
                ? {
                    ...item,
                    subagentStatus: (command.status === 'failed' ? 'failed' : 'done') as
                      'done' | 'failed',
                  }
                : item,
            );
            this.childIndex.set(parentId, next);
          }
        }
        return {
          id,
          type: 'response',
          command: 'session/complete-subagent',
          success: true,
          data: {
            sessionId: command.sessionId,
            status: command.status === 'failed' ? 'failed' : 'done',
          },
        };
      }
      case 'session/merge-subagent': {
        let parentSessionId: string | undefined;
        let childName = 'sub-agent';
        let childTask = '';
        if (this.childIndex) {
          for (const [parentId, list] of this.childIndex.entries()) {
            const found = list.find((item) => item.id === command.childSessionId);
            if (found) {
              parentSessionId = parentId;
              childName = found.name ?? childName;
              childTask = found.task ?? '';
              const messageId = crypto.randomUUID();
              const now = new Date().toISOString();
              const next: typeof list = list.map((item) => {
                if (item.id !== command.childSessionId) {
                  return item;
                }
                const updated = {
                  ...item,
                  mergedAt: now,
                  mergeMessageId: messageId,
                  summaryPreview: 'mock merge summary',
                };
                if (item.subagentStatus === 'running' || !item.subagentStatus) {
                  updated.subagentStatus = 'done';
                }
                return updated;
              });
              this.childIndex.set(parentId, next);
              const parent = this.sessions.get(parentId);
              if (parent) {
                parent.transcript.push({
                  id: messageId,
                  role: 'system',
                  text: `Sub-agent “${childName}” finished (done)\nTask: ${childTask}\nSummary:\nmock merge summary\n\nchildSessionId=${command.childSessionId}`,
                  createdAt: now,
                  status: 'done',
                });
              }
              return {
                id,
                type: 'response',
                command: 'session/merge-subagent',
                success: true,
                data: {
                  childSessionId: command.childSessionId,
                  parentSessionId,
                  messageId,
                  alreadyMerged: false,
                },
              };
            }
          }
        }
        return {
          id,
          type: 'response',
          command: 'session/merge-subagent',
          success: false,
          error: `unknown child ${command.childSessionId}`,
        };
      }

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
        if (plan.status !== 'approved' && plan.status !== 'executing') {
          return {
            id,
            type: 'response',
            command: 'plan/execute',
            success: false,
            error: `plan must be approved (current: ${plan.status})`,
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

      case 'media/save': {
        const asset = {
          id: crypto.randomUUID(),
          sessionId: command.input.sessionId,
          absolutePath: `/tmp/piwin-mock-media/${command.input.sessionId}/${crypto.randomUUID()}.png`,
          mimeType: command.input.mimeType,
          byteSize: Math.max(1, Math.floor(command.input.base64Data.length * 0.75)),
          createdAt: new Date().toISOString(),
        };
        return {
          id,
          type: 'response',
          command: 'media/save',
          success: true,
          data: { asset },
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
                id: 'piwin-dark',
                name: 'Piwin Dark',
                version: '5.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-dark',
                source: 'bundled',
                active: activeThemeId === 'piwin-dark',
              },
              {
                id: 'piwin-light',
                name: 'Piwin Light',
                version: '5.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-light',
                source: 'bundled',
                active: activeThemeId === 'piwin-light',
              },
              {
                id: 'piwin-orange-white',
                name: '橙白',
                version: '6.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-orange-white',
                source: 'bundled',
                active: activeThemeId === 'piwin-orange-white',
              },
            ],
          },
        };
      }
      case 'theme/get-active':
      case 'theme/set-active': {
        if (command.type === 'theme/set-active') {
          const nextId =
            command.themeId === 'piwin-light' || command.themeId === 'piwin-orange-white'
              ? command.themeId
              : 'piwin-dark';
          this.mockActiveThemeId = nextId;
        }
        const themeId = this.mockActiveThemeId;
        const isLight = themeId !== 'piwin-dark';
        const themeName =
          themeId === 'piwin-orange-white' ? '橙白' : isLight ? 'Piwin Light' : 'Piwin Dark';
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            theme: {
              id: themeId,
              name: themeName,
              version: '5.0.0',
              mode: isLight ? 'light' : 'dark',
              tokens: isLight
                ? {
                    bg: '#f6f2eb',
                    panel: '#fffdf9',
                    panel2: '#f7f2ea',
                    border: 'rgba(54, 40, 20, 0.12)',
                    text: '#1f1a14',
                    muted: '#6f675d',
                    accent: '#b07a36',
                    accent2: '#d89a4a',
                    danger: '#c45a4c',
                    ok: '#2f8a68',
                    radius: '12px',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  }
                : {
                    bg: '#090807',
                    panel: '#151311',
                    panel2: '#1b1916',
                    border: 'rgba(255, 236, 210, 0.10)',
                    text: '#f4efe7',
                    muted: '#a89f93',
                    accent: '#d89a4a',
                    accent2: '#f0c27a',
                    danger: '#e07a6a',
                    ok: '#79c4a3',
                    radius: '12px',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  },
              artifact: isLight
                ? {
                    bg: 'transparent',
                    surface: 'rgba(255, 253, 249, 0.96)',
                    text: '#1f1a14',
                    muted: '#6f675d',
                    accent: '#b07a36',
                    border: 'rgba(54, 40, 20, 0.12)',
                    radius: '0.75rem',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  }
                : {
                    bg: 'transparent',
                    surface: 'rgba(27, 25, 22, 0.96)',
                    text: '#f4efe7',
                    muted: '#a89f93',
                    accent: '#d89a4a',
                    border: 'rgba(255, 236, 210, 0.14)',
                    radius: '0.75rem',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  },
            },
          },
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
      case 'pet/install-local':
        return {
          id,
          type: 'response',
          command: 'pet/install-local',
          success: true,
          data: { petId: 'installed-pet', path: command.sourcePath },
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
      case 'extensions/ensure-bundled': {
        const installed = this.mockBundledExtensionsInstalled ? [] : ['path-guard'];
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

      case 'process/list':
        return {
          id,
          type: 'response',
          command: 'process/list',
          success: true,
          data: { processes: [...this.mockProcesses.values()] },
        };
      case 'process/get': {
        const processRecord = this.mockProcesses.get(command.processId);
        if (!processRecord) {
          return {
            id,
            type: 'response',
            command: 'process/get',
            success: false,
            error: `Unknown process: ${command.processId}`,
          };
        }
        return {
          id,
          type: 'response',
          command: 'process/get',
          success: true,
          data: { process: processRecord },
        };
      }
      case 'process/start': {
        const processId = crypto.randomUUID();
        const record: import('@piwin/contracts').ManagedProcessRecord = {
          id: processId,
          command: command.input.command,
          argv: [...command.input.argv],
          cwd: command.input.cwd,
          status: 'running',
          startedAt: new Date().toISOString(),
          pid: 0,
        };
        if (command.input.sessionId) record.sessionId = command.input.sessionId;
        if (command.input.projectPath) record.projectPath = command.input.projectPath;
        if (command.input.label) record.label = command.input.label;
        this.mockProcesses.set(processId, record);
        this.mockProcessLogs.set(processId, `[mock] started ${command.input.command}\n`);
        return {
          id,
          type: 'response',
          command: 'process/start',
          success: true,
          data: { process: record },
        };
      }
      case 'process/logs': {
        const text = this.mockProcessLogs.get(command.query.processId) ?? '';
        return {
          id,
          type: 'response',
          command: 'process/logs',
          success: true,
          data: {
            processId: command.query.processId,
            chunks: text
              ? [
                  {
                    processId: command.query.processId,
                    stream: 'stdout' as const,
                    text,
                    at: new Date().toISOString(),
                  },
                ]
              : [],
          },
        };
      }
      case 'process/stop': {
        const existing = this.mockProcesses.get(command.processId);
        if (!existing) {
          return {
            id,
            type: 'response',
            command: 'process/stop',
            success: false,
            error: `Unknown process: ${command.processId}`,
          };
        }
        const stopped = {
          ...existing,
          status: 'stopped' as const,
          exitedAt: new Date().toISOString(),
        };
        this.mockProcesses.set(command.processId, stopped);
        return {
          id,
          type: 'response',
          command: 'process/stop',
          success: true,
          data: { process: stopped },
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
              config: this.mockConfig,
            },
          },
        };
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
        return {
          id,
          type: 'response',
          command: 'settings/apply',
          success: true,
          data: {
            snapshot: {
              schemaVersion: 2,
              revision: this.mockSettingsRevision,
              config: this.mockConfig,
            },
            changedDomains: input.mutations.map((mutation) => ({
              domain: mutation.domain,
              timing: 'new-runtime',
              securityTightenedImmediately: mutation.domain === 'permissions',
            })),
          },
        };
      }
      case 'config/set': {
        if (!('config' in command) || !command.config) {
          return {
            id,
            type: 'response',
            command: 'config/set',
            success: false,
            error: 'config required',
          };
        }
        this.mockConfig = command.config as import('@piwin/contracts').PiwinConfig;
        this.mockSettingsRevision = `mock-settings-v${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        return {
          id,
          type: 'response',
          command: 'config/set',
          success: true,
          data: { config: this.mockConfig },
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
        const name =
          typeof command.name === 'string' && command.name.trim()
            ? command.name.trim()
            : baseName.startsWith('Copy of ')
              ? `${baseName} (2)`
              : `Copy of ${baseName}`;
        const clonedTranscript = session.transcript.map((message) => {
          const next: SessionTranscriptMessage = {
            id: crypto.randomUUID(),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            status: message.status === 'streaming' ? 'done' : message.status,
          };
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
        this.sessions.set(newId, {
          projectPath: session.projectPath,
          events: [],
          transcript: clonedTranscript,
          name,
          isPinned: false,
          isArchived: false,
        });
        const summary = this.mockSessionSummary(newId, this.sessions.get(newId)!);
        return {
          id,
          type: 'response',
          command: 'session/duplicate',
          success: true,
          data: {
            sessionId: newId,
            sourceSessionId: command.sessionId,
            session: summary,
            messages: clonedTranscript,
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
        const messageIndex = session.transcript.findIndex(
          (message) => message.id === command.messageId,
        );
        if (messageIndex === -1) {
          return {
            id,
            type: 'response',
            command: 'session/fork',
            success: false,
            error: 'session-fork-message-not-found',
          };
        }
        const sourceMessage = session.transcript[messageIndex]!;
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
        const rootName = baseName.replace(/\s*·\s*Branch(\s+\d+)?$/, '');
        const forkName =
          typeof command.name === 'string' && command.name.trim()
            ? command.name.trim()
            : `${rootName} · Branch`;
        const forkTranscript = session.transcript.slice(0, messageIndex + 1).map((message) => {
          const next: SessionTranscriptMessage = {
            id: crypto.randomUUID(),
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            status: message.status === 'streaming' ? 'done' : message.status,
          };
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
        this.sessions.set(newForkId, {
          projectPath: session.projectPath,
          events: [],
          transcript: forkTranscript,
          name: forkName,
          isPinned: false,
          isArchived: false,
        });
        const forkSummary = this.mockSessionSummary(newForkId, this.sessions.get(newForkId)!);
        const origin = {
          kind: 'fork' as const,
          rootSessionId: command.sessionId,
          sourceSessionId: command.sessionId,
          ...(session.name ? { sourceSessionNameSnapshot: session.name } : {}),
          sourceMessageId: command.messageId,
          sourceMessageRole: 'assistant' as const,
          sourceMessagePreview: sourceMessage.text.slice(0, 200),
          sourceMessageCreatedAt: sourceMessage.createdAt,
          workspaceStrategy: command.workspaceStrategy,
          createdAt: new Date().toISOString(),
        };
        return {
          id,
          type: 'response',
          command: 'session/fork',
          success: true,
          data: {
            sessionId: newForkId,
            sourceSessionId: command.sessionId,
            session: forkSummary,
            messages: forkTranscript,
            origin,
          },
        };
      }
      case 'session/lineage': {
        const targetSession = this.sessions.get(command.sessionId);
        if (!targetSession) {
          return {
            id,
            type: 'response',
            command: 'session/lineage',
            success: true,
            data: {
              rootSessionId: command.sessionId,
              activeSessionId: command.sessionId,
              rootMissing: true,
              nodes: [],
            },
          };
        }
        // In mock mode, return a minimal lineage with just the active session.
        return {
          id,
          type: 'response',
          command: 'session/lineage',
          success: true,
          data: {
            rootSessionId: command.sessionId,
            activeSessionId: command.sessionId,
            rootMissing: false,
            nodes: [
              {
                sessionId: command.sessionId,
                ...(targetSession.name ? { name: targetSession.name } : {}),
                isArchived: false,
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        };
      }
      case 'session/search': {
        const query = command.query.query.trim().toLowerCase();
        const hits = [...this.sessions.entries()]
          .filter(([sessionId, value]) => {
            if (command.query.projectPath && value.projectPath !== command.query.projectPath) {
              return false;
            }
            if (!query) return true;
            const hay = `${sessionId} ${value.projectPath}`.toLowerCase();
            return (
              hay.includes(query) ||
              value.transcript.some((m) => m.text.toLowerCase().includes(query))
            );
          })
          .map(([sessionId, value]) => ({
            sessionId,
            projectPath: value.projectPath,
            name: `session-${sessionId.slice(0, 8)}`,
            snippet: value.transcript[0]?.text?.slice(0, 80),
            isPinned: Boolean((value as { isPinned?: boolean }).isPinned),
          }));
        return {
          id,
          type: 'response',
          command: 'session/search',
          success: true,
          data: { query: command.query.query, hits },
        };
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
        const cut = session.transcript.findIndex((m) => m.id === command.messageId);
        if (cut === -1) {
          return {
            id,
            type: 'response',
            command: 'session/truncate-from',
            success: false,
            error: `Message not found in transcript: ${command.messageId}`,
          };
        }
        const removedCount = session.transcript.length - cut;
        session.transcript = session.transcript.slice(0, cut);
        return {
          id,
          type: 'response',
          command: 'session/truncate-from',
          success: true,
          data: {
            sessionId: command.sessionId,
            removedCount,
            remainingCount: session.transcript.length,
            messages: session.transcript,
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
          data: { sessionId: command.sessionId, items: [], updatedAt: new Date().toISOString() },
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
        session.transcript.push(historyMessage);
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
    this.pushEvent(sessionId, {
      type: 'run/phase',
      sessionId,
      runId,
      phase: 'waiting-first-token',
      at: new Date().toISOString(),
    });
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
    this.pushEvent(sessionId, {
      type: 'run/phase',
      sessionId,
      runId,
      phase: 'streaming',
      at: new Date().toISOString(),
    });

    let assembled = '';
    try {
      for (const chunk of chunkText(reply, 28)) {
        if (controller.signal.aborted) {
          if (session) {
            session.transcript.push({
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
          this.emitMockTerminal(sessionId, runId, 'cancelled', 'cancelled');
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
          session.transcript.push({
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
        this.emitMockTerminal(sessionId, runId, 'cancelled', 'cancelled');
        return;
      }

      if (session) {
        session.transcript.push({
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
    outcome: 'completed' | 'cancelled' | 'failed',
    code?: 'cancelled',
  ): void {
    if (this.mockTerminalRunIds.has(runId)) {
      return;
    }
    this.mockTerminalRunIds.add(runId);
    if (this.mockActiveRunIds.get(sessionId) === runId) {
      this.mockActiveRunIds.delete(sessionId);
    }
    this.pushEvent(sessionId, {
      type: 'run/terminal',
      sessionId,
      runId,
      outcome,
      at: new Date().toISOString(),
      ...(code ? { code } : {}),
    });
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
    const name = firstUser?.text?.replace(/\s+/g, ' ').trim().slice(0, 60);
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
