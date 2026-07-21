import type {
  AgentEvent,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostServerMessage,
  SessionSummary,
  SessionTranscriptMessage,
} from '@piwin/contracts';

export type HostClientListener = (message: HostServerMessage) => void;

export type HostClientOptions = {
  /**
   * true  → in-browser mock (Vite only)
   * false → Tauri sidecar `piwin host serve` JSONL bridge
   * 'auto'→ mock outside Tauri, live inside Tauri
   */
  transport?: boolean | 'auto' | 'mock' | 'live';
  /** When using live transport, start host with --mock (agent mock, not UI mock). Default true for scaffold. */
  hostMock?: boolean;
};

type TransportMode = 'mock' | 'live';

function detectTransport(options: HostClientOptions): TransportMode {
  const requested = options.transport ?? 'auto';
  if (requested === 'mock' || requested === true) {
    return 'mock';
  }
  if (requested === 'live' || requested === false) {
    return 'live';
  }
  // auto
  return isTauriRuntime() ? 'live' : 'mock';
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Frontend host client. Never imports Pi.
 * - mock: in-process deterministic events (browser Vite)
 * - live: Tauri commands → Node `host serve` JSONL sidecar
 */
export class HostClient {
  private readonly listeners = new Set<HostClientListener>();
  private readonly transport: TransportMode;
  private readonly hostMock: boolean;
  private mode: HostMode = 'sdk';
  private ready = false;
  private sessions = new Map<
    string,
    { projectPath: string; events: AgentEvent[]; transcript: SessionTranscriptMessage[] }
  >();
  private plans = new Map<string, import('@piwin/contracts').SessionPlan>();
  private childIndex = new Map<string, import('@piwin/contracts').SessionSummary[]>();
  private requestCounter = 0;
  /** Mock-only: extension ids disabled via extensions/set_enabled. */
  private mockDisabledExtensionIds = new Set<string>();
  private mockBundledExtensionsInstalled = true;
  private mockDisabledPromptIds = new Set<string>();
  private mockActiveThemeId: 'piwin-dark' | 'piwin-light' = 'piwin-dark';
  private mockProcesses = new Map<string, import('@piwin/contracts').ManagedProcessRecord>();
  private mockProcessLogs = new Map<string, string>();
  private mockConfig: import('@piwin/contracts').PiwinConfig = {
    hostMode: 'sdk',
    providers: [],
    media: {
      maxPasteBytes: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    artifact: { maxBytes: 100 * 1024, htmlUiModeDefault: true },
  };
  private unlistenHostMessage: (() => void) | null = null;
  private unlistenHostLog: (() => void) | null = null;

  constructor(options: HostClientOptions = {}) {
    this.transport = detectTransport(options);
    this.hostMock = options.hostMock !== false;
  }

  getTransport(): TransportMode {
    return this.transport;
  }

  subscribe(listener: HostClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.transport === 'mock') {
      this.ready = true;
      this.emit({
        type: 'host/status',
        mode: this.mode,
        ready: true,
        mock: true,
      });
      return;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const { listen } = await import('@tauri-apps/api/event');

    this.unlistenHostMessage = await listen<HostServerMessage>('host-message', (event) => {
      this.emit(event.payload);
      if (event.payload.type === 'host/status') {
        this.ready = event.payload.ready;
        this.mode = event.payload.mode;
      }
    });

    this.unlistenHostLog = await listen<{ level: string; message: string }>('host-log', (event) => {
      const level = event.payload.level;
      const message = event.payload.message;
      const normalizedLevel =
        level === 'error' || level === 'warn' || level === 'info' ? level : 'info';
      // Surface bridge-side logs to UI subscribers (HostLogPanel), not only console.
      this.emit({
        type: 'host/log',
        level: normalizedLevel,
        message,
      });
      if (level === 'error') {
        console.error('[host]', message);
      } else if (level === 'warn') {
        console.warn('[host]', message);
      } else {
        console.info('[host]', message);
      }
    });

    await invoke('host_start', { mock: this.hostMock });
    // host serve emits host/status immediately; also probe
    const status = await this.request({ type: 'host/status' });
    if (status.success) {
      this.ready = true;
    } else {
      this.emit({
        type: 'host/log',
        level: 'error',
        message: status.error,
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.unlistenHostMessage) {
      this.unlistenHostMessage();
      this.unlistenHostMessage = null;
    }
    if (this.unlistenHostLog) {
      this.unlistenHostLog();
      this.unlistenHostLog = null;
    }

    if (this.transport === 'live' && isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('host_stop');
      } catch (error) {
        console.warn('host_stop failed', error);
      }
    }

    this.listeners.clear();
    this.sessions.clear();
    this.ready = false;
  }

  async request(command: HostCommand): Promise<HostResponse> {
    const id = command.id ?? `ui-${++this.requestCounter}`;
    const withId = { ...command, id } as HostCommand;

    if (this.transport === 'mock') {
      return this.handleMock(withId, id);
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const response = (await invoke('host_request', {
        command: withId,
        timeoutMs: 60_000,
      })) as HostResponse;
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id,
        type: 'response',
        command: withId.type,
        success: false,
        error: message,
      };
    }
  }

  private async handleMock(command: HostCommand, id: string): Promise<HostResponse> {
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
            mode: this.mode,
            ready: this.ready || true,
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
              usage: true,
            },
          },
        };
      case 'project/open':
        return {
          id,
          type: 'response',
          command: 'project/open',
          success: true,
          data: { path: command.path, trusted: false, trust: 'untrusted' },
        };
      case 'project/trust':
        return {
          id,
          type: 'response',
          command: 'project/trust',
          success: true,
          data: { path: command.path, trusted: true, trust: 'trusted' },
        };
      case 'session/list': {
        const sessions: SessionSummary[] = [...this.sessions.entries()].map(
          ([sessionId, value]) => ({
            id: sessionId,
            projectPath: value.projectPath,
            updatedAt: new Date().toISOString(),
            messageCount: value.events.length,
            name: `session-${sessionId.slice(0, 8)}`,
          }),
        );
        return { id, type: 'response', command: 'session/list', success: true, data: { sessions } };
      }
      case 'session/create': {
        const sessionId = crypto.randomUUID();
        this.sessions.set(sessionId, {
          projectPath: command.input.projectPath,
          events: [],
          transcript: [],
        });
        this.emit({ type: 'host/status', mode: this.mode, ready: true, mock: true });
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
        const now = new Date().toISOString();
        const userMessage: SessionTranscriptMessage = {
          id: crypto.randomUUID(),
          role: 'user',
          text: command.input.text,
          createdAt: now,
          status: 'done',
        };
        if (command.input.attachments && command.input.attachments.length > 0) {
          userMessage.attachments = command.input.attachments;
        }
        session.transcript.push(userMessage);
        const attachmentNote =
          command.input.attachments && command.input.attachments.length > 0
            ? `\n[attachments: ${command.input.attachments.map((item) => item.path).join(', ')}]`
            : '';
        const replyText = `mock: ${command.input.text}${attachmentNote}`;
        session.transcript.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: replyText,
          createdAt: now,
          status: 'done',
        });
        await this.emitMockPrompt(command.sessionId, `${command.input.text}${attachmentNote}`);
        return {
          id,
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: { sessionId: command.sessionId },
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
          events: [],
          transcript: [],
        });
        const childMeta = {
          id: childId,
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
                      | 'done'
                      | 'failed',
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
        this.emit({ type: 'plan/updated', sessionId: command.sessionId, plan: command.plan });
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
        this.emit({ type: 'plan/updated', sessionId: command.sessionId, plan: null });
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
        this.emit({ type: 'plan/updated', sessionId: command.sessionId, plan: approved });
        return {
          id,
          type: 'response',
          command: 'plan/approve',
          success: true,
          data: { plan: approved },
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
          data: { result: { kind: command.type.replace('git/', ''), ok: true, message: `mock ${command.type}` } },
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
                version: '2.0.0',
                mode: 'dark',
                path: '/mock/themes/piwin-dark',
                source: 'bundled',
                active: activeThemeId === 'piwin-dark',
              },
              {
                id: 'piwin-light',
                name: 'Piwin Light',
                version: '2.0.0',
                mode: 'light',
                path: '/mock/themes/piwin-light',
                source: 'bundled',
                active: activeThemeId === 'piwin-light',
              },
            ],
          },
        };
      }
      case 'theme/get-active':
      case 'theme/set-active': {
        if (command.type === 'theme/set-active') {
          const nextId = command.themeId === 'piwin-light' ? 'piwin-light' : 'piwin-dark';
          this.mockActiveThemeId = nextId;
        }
        const themeId = this.mockActiveThemeId;
        const isLight = themeId === 'piwin-light';
        return {
          id,
          type: 'response',
          command: command.type,
          success: true,
          data: {
            theme: {
              id: themeId,
              name: isLight ? 'Piwin Light' : 'Piwin Dark',
              version: '2.0.0',
              mode: isLight ? 'light' : 'dark',
              tokens: isLight
                ? {
                    bg: '#f3f5f9',
                    panel: '#ffffff',
                    panel2: '#eef1f7',
                    border: '#d5dbe8',
                    text: '#111827',
                    muted: '#5f6b7c',
                    accent: '#3b6ff5',
                    accent2: '#2f5de0',
                    danger: '#dc2626',
                    ok: '#16a34a',
                    radius: '10px',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  }
                : {
                    bg: '#090b0f',
                    panel: '#11151d',
                    panel2: '#171c25',
                    border: '#293241',
                    text: '#eef2f8',
                    muted: '#8792a5',
                    accent: '#7ca8ff',
                    accent2: '#5d8df6',
                    danger: '#ff7b72',
                    ok: '#66d49b',
                    radius: '10px',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  },
              artifact: isLight
                ? {
                    bg: 'transparent',
                    surface: 'rgba(255, 255, 255, 0.96)',
                    text: '#111827',
                    muted: '#5f6b7c',
                    accent: '#3b6ff5',
                    border: 'rgba(17, 24, 39, 0.12)',
                    radius: '0.75rem',
                    font: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
                  }
                : {
                    bg: 'transparent',
                    surface: 'rgba(23, 28, 37, 0.94)',
                    text: '#eef2f8',
                    muted: '#8792a5',
                    accent: '#7ca8ff',
                    border: 'rgba(76, 89, 112, 0.45)',
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
      case 'pet/import-codex':
        return {
          id,
          type: 'response',
          command: 'pet/import-codex',
          success: true,
          data: { imported: [], skipped: [], errors: [] },
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
            document: { mcpServers: {} },
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
      case 'mcp/save':
        return {
          id,
          type: 'response',
          command: 'mcp/save',
          success: true,
          data: {
            path: '~/.piwin/mcp.json',
            document: command.document ?? { mcpServers: {} },
          },
        };
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
      case 'session/abort':
        return {
          id,
          type: 'response',
          command: 'session/abort',
          success: true,
          data: { sessionId: command.sessionId },
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
        this.emit({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
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
        this.emit({ type: 'plan/updated', sessionId: command.sessionId, plan: updated });
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
        return {
          id,
          type: 'response',
          command: 'config/set',
          success: true,
          data: { config: this.mockConfig },
        };
      }
      case 'session/pin': {
        const session = this.sessions.get(command.sessionId);
        if (!session) {
          return { id, type: 'response', command: 'session/pin', success: false, error: 'unknown session' };
        }
        (session as { isPinned?: boolean }).isPinned = true;
        return {
          id,
          type: 'response',
          command: 'session/pin',
          success: true,
          data: {
            sessionId: command.sessionId,
            isPinned: true,
            session: {
              id: command.sessionId,
              projectPath: session.projectPath,
              updatedAt: new Date().toISOString(),
              messageCount: session.events.length,
              name: `session-${command.sessionId.slice(0, 8)}`,
              isPinned: true,
            },
          },
        };
      }
      case 'session/unpin': {
        const session = this.sessions.get(command.sessionId);
        if (!session) {
          return { id, type: 'response', command: 'session/unpin', success: false, error: 'unknown session' };
        }
        (session as { isPinned?: boolean }).isPinned = false;
        return {
          id,
          type: 'response',
          command: 'session/unpin',
          success: true,
          data: {
            sessionId: command.sessionId,
            isPinned: false,
            session: {
              id: command.sessionId,
              projectPath: session.projectPath,
              updatedAt: new Date().toISOString(),
              messageCount: session.events.length,
              name: `session-${command.sessionId.slice(0, 8)}`,
              isPinned: false,
            },
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
            return hay.includes(query) || value.transcript.some((m) => m.text.toLowerCase().includes(query));
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
        const removedCount = cut === -1 ? 0 : session.transcript.length - cut;
        if (cut !== -1) {
          session.transcript = session.transcript.slice(0, cut);
        }
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

  private async emitMockPrompt(sessionId: string, text: string): Promise<void> {
    const assistantId = crypto.randomUUID();
    const toolId = crypto.randomUUID();
    const reply = `piwin desktop mock reply.\nYou said: ${text}`;

    const events: AgentEvent[] = [
      { type: 'message/start', messageId: assistantId, role: 'assistant' },
      { type: 'tool/start', toolCallId: toolId, toolName: 'mock_echo' },
      { type: 'tool/end', toolCallId: toolId, isError: false },
    ];

    for (const event of events) {
      this.pushEvent(sessionId, event);
    }

    for (const chunk of chunkText(reply, 28)) {
      this.pushEvent(sessionId, {
        type: 'message/text_delta',
        messageId: assistantId,
        delta: chunk,
      });
      await delay(12);
    }

    this.pushEvent(sessionId, { type: 'message/end', messageId: assistantId });
  }

  private pushEvent(sessionId: string, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.events.push(event);
    }
    this.emit({ type: 'event', sessionId, event });
  }

  private emit(message: HostPush | HostServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
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
