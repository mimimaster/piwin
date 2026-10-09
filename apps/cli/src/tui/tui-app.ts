import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Key,
  Loader,
  matchesKey,
  type TUI,
  type TuiInputListenerResult,
} from '@earendil-works/pi-tui';
import type {
  HostCommand,
  HostPush,
  RemotePendingPermission,
  RemoteProjectSummary,
  RemoteSessionListData,
  RemoteSessionResumeData,
  RemoteSessionTranscriptPageData,
  SessionContextSnapshot,
} from '@piwin/contracts';
import {
  applyForegroundRunResponse,
  applyHostPushToForeground,
  initialForegroundRunState,
  knownForegroundRunId,
  type ForegroundRunState,
} from '@piwin/host-client';
import { TextOverlay } from './choice-overlay.js';
import { StatusLine, describeRunPhase } from './status-line.js';
import {
  EMPTY_TRANSCRIPT,
  appendLocalUserMessage,
  removeLocalUserMessage,
  appendNotice,
  appendNoticeOnce,
  applyAgentEvent,
  prependOlderMessages,
  settleStreaming,
  transcriptFromMessages,
  type TranscriptState,
} from './transcript-model.js';
import { TranscriptView } from './transcript-view.js';
import { createTuiCommandTable } from './tui-command-table.js';
import { TUI_COMMAND_NAMES, TUI_SLASH_COMMANDS, parseSlashCommand } from './tui-commands.js';
import { TuiComposerProfile } from './tui-composer-profile.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import { TuiModalStack, createExtensionModal, createPermissionModal } from './tui-modals.js';
import { TuiPromptSender } from './tui-prompt-sender.js';
import { TuiSessionFeatures } from './tui-session-features.js';
import { TuiSessionExport } from './tui-session-export.js';
import { TuiSessionSwitcher } from './tui-session-switcher.js';
import { TuiSideChatController } from './tui-side-chat-controller.js';
import { TuiTurnActions } from './tui-turn-actions.js';
import { ProjectFiles } from './project-files.js';
import { TuiArtifactController, type FileOpener } from './tui-artifact-controller.js';
import { TuiAttachmentController } from './tui-attachment-controller.js';
import { TuiAutocompleteProvider } from './tui-autocomplete.js';
import { editorTheme, style } from './tui-theme.js';

const SESSION_LOOKUP_LIMIT = 500;
const STATUS_HINT_MS = 4_000;
const TRANSCRIPT_PAGE_ITEMS = 50;
const TRANSCRIPT_PAGE_BYTES = 256 * 1024;
const EXIT_CONFIRM_WINDOW_MS = 1_500;

export type TuiAppOptions = {
  tui: TUI;
  link: TuiHostLink;
  /** Open this session at start. */
  sessionId?: string;
  /** Scope for sessions created here; absent means the general workspace. */
  projectId?: string;
  /** Desktop-embedded pane: pinned to one session, Desktop's sidebar switches. */
  embedded: boolean;
  mock: boolean;
  /** Something the launch has to tell the user, shown once above the composer. */
  startNotice?: string;
  onExit: () => void;
  /** How an exported artifact page reaches a browser; the system opener by default. */
  openFile?: FileOpener;
};

/**
 * TUI controller: owns no session data. Everything shown comes from Host
 * responses and pushes; every change goes back as a HostCommand.
 */
export class TuiApp {
  private readonly tui: TUI;
  private readonly link: TuiHostLink;
  private readonly transcriptView: TranscriptView;
  private readonly activitySlot = new Container();
  private readonly editor: Editor;
  private readonly statusLine = new StatusLine();
  private readonly loader: Loader;

  private transcript: TranscriptState = EMPTY_TRANSCRIPT;
  private sessionId: string | undefined;
  /** The `session/create` in flight, shared by everything that needs a session. */
  private creatingSession: Promise<string> | undefined;
  /** Replaced whenever the user moves to another conversation; see `TuiPromptSender`. */
  private conversation: object = {};
  private sessionName: string | undefined;
  private olderCursor: string | undefined;
  private projectId: string | undefined;
  /** Project of the session on screen: what `@` mentions are resolved against. */
  private sessionProjectId: string | undefined;
  private readonly files: ProjectFiles;
  private readonly attachments: TuiAttachmentController;
  private readonly features: TuiSessionFeatures;
  private readonly sideChat: TuiSideChatController;
  private readonly turns: TuiTurnActions;
  private readonly sender: TuiPromptSender;
  private readonly runCommand: (name: string, argument: string) => Promise<void>;
  /** `/edit`: the next prompt replaces this user turn as a sibling branch. */
  private editingMessageId: string | undefined;
  private projects: RemoteProjectSummary[] = [];
  private readonly composer: TuiComposerProfile;
  private context: SessionContextSnapshot | undefined;
  private foreground: ForegroundRunState = initialForegroundRunState();
  private foregroundGeneration = 0;
  /** Bumped on every session switch so late responses for the old session are dropped. */
  private sessionEpoch = 0;
  private connected = true;
  /** A transient line in the status bar; kept for a few seconds, not one frame. */
  private statusHint: { text: string; timer: ReturnType<typeof setTimeout> } | undefined;
  private lastInterruptAt = 0;

  private readonly modals: TuiModalStack;
  private readonly sessionSwitcher: TuiSessionSwitcher;
  private readonly sessionExport: TuiSessionExport;
  private readonly disposers: Array<() => void> = [];

  public constructor(private readonly options: TuiAppOptions) {
    this.tui = options.tui;
    this.link = options.link;
    this.projectId = options.projectId;
    this.transcriptView = new TranscriptView(options.embedded);
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => {
      this.submit(text).catch((error: unknown) => this.reportError(error));
    };
    this.sessionProjectId = options.projectId;
    this.files = new ProjectFiles({
      request: (command) => this.link.request(command),
      getProjectId: () => this.sessionProjectId,
    });
    this.loader = new Loader(this.tui, style.cyan, style.gray, '');
    this.modals = new TuiModalStack(this.tui, this.editor, () => this.sessionSwitcher.handleOverlayClosed());
    this.composer = new TuiComposerProfile({
      link: this.link,
      modals: this.modals,
      getSessionId: () => this.sessionId,
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onError: (error) => this.reportError(error),
    });
    this.attachments = new TuiAttachmentController({
      link: this.link,
      ensureSession: () => this.ensureSession(),
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onNotice: (tone, text) => {
        this.transcript = appendNotice(this.transcript, tone, text);
        this.refreshChrome();
      },
    });
    const notify = (tone: 'info' | 'error', text: string): void => {
      this.transcript = appendNotice(this.transcript, tone, text);
      this.refreshChrome();
    };
    this.features = new TuiSessionFeatures({
      link: this.link,
      modals: this.modals,
      embedded: options.embedded,
      getSessionId: () => this.sessionId,
      getRunId: () => knownForegroundRunId(this.foreground),
      getTranscript: () => this.transcript,
      isRunning: () => this.isRunning(),
      openSession: (sessionId) => this.openSession(sessionId),
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
      onError: (error) => this.reportError(error),
      echoUser: (messageId, text, annotations) => {
        this.transcript = appendLocalUserMessage(this.transcript, messageId, text, annotations);
      },
      setComposerText: (text) => {
        this.editor.setText(text);
        this.tui.requestRender();
      },
    });
    this.sideChat = new TuiSideChatController({
      link: this.link,
      modals: this.modals,
      getSessionId: () => this.sessionId,
      getTranscript: () => this.transcript,
      isRunning: () => this.isRunning(),
      openSession: (sessionId) => this.openSession(sessionId),
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
      onError: (error) => this.reportError(error),
    });
    this.turns = new TuiTurnActions({
      request: (command) => this.link.request(command),
      embedded: options.embedded,
      sessionId: () => this.sessionId,
      runId: () => knownForegroundRunId(this.foreground),
      isRunning: () => this.isRunning(),
      transcript: () => this.transcript,
      promptFields: () => this.composer.promptFields(),
      hint: (text) => this.flashHint(text),
      notice: notify,
      echoUser: (messageId, text, annotations) => {
        this.transcript = appendLocalUserMessage(this.transcript, messageId, text, annotations);
        this.refreshChrome();
      },
      openSession: (sessionId) => this.openSession(sessionId),
      beginEdit: (messageId, text) => {
        this.editingMessageId = messageId;
        this.editor.setText(text);
        this.refreshChrome();
      },
    });
    this.sender = new TuiPromptSender({
      link: this.link,
      queue: this.features.queue,
      attachments: this.attachments,
      files: this.files,
      composer: this.composer,
      sideChat: this.sideChat,
      conversation: () => this.conversation,
      ensureSession: () => this.ensureSession(),
      isRunning: () => this.isRunning(),
      runId: () => knownForegroundRunId(this.foreground),
      editingMessageId: () => this.editingMessageId,
      clearEditing: () => {
        this.editingMessageId = undefined;
      },
      echoUser: (messageId, text, annotations) => {
        this.transcript = appendLocalUserMessage(this.transcript, messageId, text, annotations);
        this.refreshChrome();
      },
      removeEcho: (messageId) => {
        this.transcript = removeLocalUserMessage(this.transcript, messageId);
        this.refreshChrome();
      },
      returnToComposer: (text) => {
        const typed = this.editor.getText();
        this.editor.setText(typed.length === 0 ? text : `${text}\n${typed}`);
        this.tui.requestRender();
      },
      onTurnAccepted: async (sessionId) => {
        if (this.isRunning() || sessionId !== this.sessionId) return;
        // Show activity immediately; the run/updated push supplies the real run id.
        await this.reconcileForegroundRun(sessionId, this.sessionEpoch);
        this.refreshChrome();
      },
      reloadSession: (sessionId) => this.openSession(sessionId),
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
    });
    this.sessionSwitcher = new TuiSessionSwitcher({
      link: this.link,
      modals: this.modals,
      getProjects: () => this.projects,
      getCurrentSessionId: () => this.sessionId,
      onOpen: (sessionId) => {
        this.openSession(sessionId).catch((error: unknown) => this.reportError(error));
      },
      onNew: () => this.startDraftSession(),
      onRename: (sessionId, name) => this.renameSession(sessionId, name),
      onError: (error) => this.reportError(error),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
      requestRender: () => this.tui.requestRender(),
    });
    this.sessionExport = new TuiSessionExport({
      link: this.link,
      getSessionId: () => this.sessionId,
      defaultDir: () => process.cwd(),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
    });
    this.tui.addChild(this.transcriptView);
    this.tui.addChild(this.activitySlot);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.statusLine);
    this.runCommand = createTuiCommandTable({
      embedded: options.embedded,
      composer: this.composer,
      attachments: this.attachments,
      plans: this.features.plans,
      queue: this.features.queue,
      branches: this.features.branches,
      subagents: this.features.subagents,
      turnChanges: this.features.turnChanges,
      walkthroughs: this.features.walkthroughs,
      sideChat: this.sideChat,
      artifacts: new TuiArtifactController({
        modals: this.modals,
        getTranscript: () => this.transcript,
        onHint: (text) => this.flashHint(text),
        onNotice: notify,
        onError: (error) => this.reportError(error),
        ...(options.openFile === undefined ? {} : { openFile: options.openFile }),
      }),
      turns: this.turns,
      sessionSwitcher: this.sessionSwitcher,
      sessionExport: this.sessionExport,
      startDraftSession: () => this.startDraftSession(),
      loadOlderMessages: () => this.loadOlderMessages(),
      renameSession: (name) => this.renameCurrentSession(name),
      sendReplacingRun: (text) => {
        this.editor.addToHistory(text.trim());
        return this.sender.send(text, true);
      },
      setComposerText: (text) => {
        this.editor.setText(text);
        this.tui.requestRender();
      },
      hint: (text) => this.flashHint(text),
      notice: notify,
      exit: () => options.onExit(),
    });
    this.tui.setFocus(this.editor);
    this.rebuildAutocomplete();
  }

  public async start(): Promise<void> {
    this.disposers.push(
      this.link.client.subscribePush((push) => this.handlePush(push)),
      this.link.client.subscribeState((state) => {
        const connected = state.kind === 'ready';
        const reconnected = connected && !this.connected;
        this.connected = connected;
        this.refreshChrome();
        // Pushes missed while offline are not replayed into this view; reload instead.
        if (reconnected && this.sessionId !== undefined) {
          this.openSession(this.sessionId).catch((error: unknown) => this.reportError(error));
        }
      }),
      this.tui.addInputListener((data) => this.handleGlobalInput(data)),
    );
    this.tui.start();
    this.refreshChrome();
    await Promise.all([
      this.loadProjects(),
      this.composer.loadModels(),
      this.composer.loadHostPermissionPreset(),
      this.composer.loadPromptTemplates(),
    ]);
    this.rebuildAutocomplete();
    if (this.options.sessionId !== undefined) {
      await this.openSession(this.options.sessionId);
    }
    if (this.options.startNotice !== undefined) {
      // After the session opened: opening replaces the transcript.
      this.transcript = appendNotice(this.transcript, 'info', this.options.startNotice);
    }
    this.refreshChrome();
  }

  public dispose(): void {
    if (this.statusHint !== undefined) clearTimeout(this.statusHint.timer);
    this.loader.stop();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  // ---------------------------------------------------------------- sessions

  /** TUI commands plus the Host's prompt templates, which arrive after start. */
  private rebuildAutocomplete(): void {
    const commands = [
      ...TUI_SLASH_COMMANDS.filter((command) => !this.options.embedded || !command.standaloneOnly),
      ...this.composer.promptCommands(TUI_COMMAND_NAMES),
    ];
    this.editor.setAutocompleteProvider(
      new TuiAutocompleteProvider(new CombinedAutocompleteProvider(commands, process.cwd()), this.files),
    );
  }

  private async openSession(sessionId: string): Promise<void> {
    const epoch = (this.sessionEpoch += 1);
    // Reloading the session on screen is the same conversation.
    if (sessionId !== this.sessionId) this.conversation = {};
    const previous = { sessionId: this.sessionId, projectId: this.sessionProjectId };
    await this.link.client.updateSubscriptions([sessionId]);
    const resume = hostData<RemoteSessionResumeData>(
      await this.link.request({ type: 'session/resume', sessionId }),
    );
    if (epoch !== this.sessionEpoch) return;
    this.sessionId = sessionId;
    this.sessionName = resume.name;
    this.sessionProjectId =
      resume.scope === 'project'
        ? ((await this.lookUpSessionProjectId(sessionId)) ??
          // A side chat is not in the session index; it lives in its source's project.
          (this.sideChat.sourceSessionOf(sessionId) === previous.sessionId ? previous.projectId : undefined))
        : undefined;
    if (epoch !== this.sessionEpoch) return;
    this.transcript = transcriptFromMessages(resume.messages);
    this.olderCursor = resume.transcriptPage?.olderCursor;
    // Pushes only report changes; a reopened idle session would show no usage without this.
    this.context = resume.contextSnapshot;
    if (resume.model !== undefined) this.composer.adoptSessionModel(resume.model);
    this.modals.clearQueue();
    await this.reconcileForegroundRun(sessionId, epoch);
    if (epoch !== this.sessionEpoch) return;
    await this.features.load(sessionId);
    if (epoch !== this.sessionEpoch) return;
    this.editingMessageId = undefined;
    await this.loadPendingPermissions(sessionId, epoch);
    // The previous session's lines are still on screen and in scrollback.
    this.transcriptView.invalidate();
    this.refreshChrome(true);
    this.modals.pump();
  }

  /** Requests raised before this shell opened the session (or while it was offline). */
  private async loadPendingPermissions(sessionId: string, epoch: number): Promise<void> {
    const data = hostData<{ permissions?: RemotePendingPermission[] }>(
      await this.link.request({ type: 'permission/pending-list' }),
    );
    if (epoch !== this.sessionEpoch) return;
    for (const pending of data.permissions ?? []) {
      if (pending.sessionId === sessionId) {
        this.queuePermission(pending.requestId, pending.action, pending.detail);
      }
    }
  }

  /** The resume payload says "project" but not which one; the index does. */
  private async lookUpSessionProjectId(sessionId: string): Promise<string | undefined> {
    const response = await this.link.request({
      type: 'session/list',
      scopeRef: { kind: 'all-authorized' },
      order: 'updated',
      maxItems: SESSION_LOOKUP_LIMIT,
      includeArchived: true,
    });
    if (!response.success) return undefined;
    return (response.data as RemoteSessionListData).sessions.find((session) => session.sessionId === sessionId)
      ?.projectId;
  }

  private startDraftSession(): void {
    this.sessionEpoch += 1;
    this.conversation = {};
    this.sessionId = undefined;
    this.sessionName = undefined;
    this.sessionProjectId = this.projectId;
    this.features.reset();
    this.editingMessageId = undefined;
    this.transcript = EMPTY_TRANSCRIPT;
    this.olderCursor = undefined;
    this.context = undefined;
    this.foreground = initialForegroundRunState();
    this.modals.clearQueue();
    this.transcriptView.invalidate();
    this.refreshChrome(true);
  }

  private async reconcileForegroundRun(sessionId: string, epoch: number): Promise<void> {
    const generation = (this.foregroundGeneration += 1);
    const asked: ForegroundRunState = { kind: 'reconciling', generation };
    this.foreground = asked;
    const response = await this.link.request({ type: 'session/foreground-run', sessionId });
    if (epoch !== this.sessionEpoch) return;
    // Run pushes that arrived while the question was in flight are at least
    // as new as the answer (same ordered link). An answer taken before the
    // Host registered the run must not put a running turn back to idle, and
    // one naming an earlier run must not replace the turn the pushes named.
    if (this.foreground !== asked) return;
    this.foreground = applyForegroundRunResponse(asked, response, generation, sessionId);
    if (this.foreground.kind !== 'active') {
      this.foreground = { kind: 'idle', generation };
      this.transcript = settleStreaming(this.transcript);
    }
  }

  /**
   * One `session/create` at a time: every caller that needs a session while
   * one is being created shares that creation. A failed creation is dropped,
   * so the next caller starts a fresh one instead of waiting on the failure.
   */
  private ensureSession(): Promise<string> {
    if (this.sessionId !== undefined) return Promise.resolve(this.sessionId);
    this.creatingSession ??= this.createSession().finally(() => {
      this.creatingSession = undefined;
    });
    return this.creatingSession;
  }

  private async createSession(): Promise<string> {
    const conversation = this.conversation;
    const model = this.composer.modelRef();
    const created = hostData<{ sessionId: string }>(
      await this.link.request({
        type: 'session/create',
        input: {
          ...(this.projectId === undefined
            ? { scope: { kind: 'general' as const } }
            : { projectId: this.projectId }),
          ...(model === undefined ? {} : { model }),
        },
      }),
    );
    if (conversation !== this.conversation) {
      // The user moved on while the session was being created; pulling them
      // back into it would replace the conversation they chose.
      throw new Error('会话已切换，新建的会话没有打开');
    }
    this.sessionEpoch += 1;
    this.sessionId = created.sessionId;
    this.foreground = { kind: 'idle', generation: (this.foregroundGeneration += 1) };
    await this.link.client.updateSubscriptions([created.sessionId]);
    return created.sessionId;
  }

  private async loadOlderMessages(): Promise<void> {
    if (this.sessionId === undefined || this.olderCursor === undefined) {
      this.flashHint('没有更早的消息');
      return;
    }
    const epoch = this.sessionEpoch;
    const page = hostData<RemoteSessionTranscriptPageData>(
      await this.link.request({
        type: 'session/transcript-page',
        query: {
          sessionId: this.sessionId,
          limit: TRANSCRIPT_PAGE_ITEMS,
          maximumBytes: TRANSCRIPT_PAGE_BYTES,
          beforeCursor: this.olderCursor,
        },
      }),
    );
    if (epoch !== this.sessionEpoch) return;
    if (page.status !== 'page') {
      // The transcript changed under the cursor; reload from the tail.
      await this.openSession(this.sessionId);
      return;
    }
    this.transcript = prependOlderMessages(this.transcript, page.messages);
    this.olderCursor = page.page.olderCursor;
    this.refreshChrome(true);
  }

  // ------------------------------------------------------------------ prompt

  private async submit(rawText: string): Promise<void> {
    const typedText = rawText.trim();
    if (typedText.length === 0) return;
    this.editor.setText('');
    const command = parseSlashCommand(typedText);
    if (command !== undefined) {
      await this.runCommand(command.name, command.argument);
      return;
    }
    this.editor.addToHistory(typedText);
    await this.sender.send(rawText, false);
  }

  /** The session this shell shows, once it has one. */
  public currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Whether a turn is in flight. Read fresh each time: pushes change it across every await. */
  public isRunning(): boolean {
    return this.foreground.kind === 'active';
  }

  /** `/rename name` renames now; bare `/rename` asks for the name. */
  private async renameCurrentSession(name: string): Promise<void> {
    const sessionId = this.sessionId;
    if (sessionId === undefined) {
      this.flashHint('当前还没有会话');
      return;
    }
    if (name.length > 0) {
      await this.renameSession(sessionId, name);
      return;
    }
    this.modals.show(
      new TextOverlay({
        title: '重命名会话',
        ...(this.sessionName === undefined ? {} : { initialValue: this.sessionName }),
        onSubmit: (value) => {
          this.modals.close();
          if (value.trim().length > 0) {
            this.renameSession(sessionId, value.trim()).catch((error: unknown) => this.reportError(error));
          }
        },
        onCancel: () => this.modals.close(),
      }),
    );
  }

  private async renameSession(sessionId: string, name: string): Promise<void> {
    hostData(await this.link.request({ type: 'session/rename', sessionId, name }));
    if (sessionId === this.sessionId) {
      this.sessionName = name;
      this.refreshChrome();
    }
  }

  // ------------------------------------------------------------------ pushes

  private handlePush(push: HostPush): void {
    const foreground = applyHostPushToForeground(this.foreground, push, this.sessionId);
    if (foreground !== this.foreground) {
      const wasActive = this.foreground.kind === 'active';
      this.foreground = foreground;
      if (wasActive && foreground.kind !== 'active') {
        this.transcript = settleStreaming(this.transcript);
        if (push.type === 'run/terminal' && push.run.status === 'failed' && push.run.error !== undefined) {
          this.transcript = appendNoticeOnce(this.transcript, 'error', push.run.error);
        }
        // The turn's own `session/aborted` event does not always reach this
        // shell; the run record does, and an interrupt must never end in silence.
        if (push.type === 'run/terminal' && (push.run.status === 'cancelled' || push.run.status === 'interrupted')) {
          this.transcript = appendNoticeOnce(this.transcript, 'info', '已中断');
        }
      }
      this.refreshChrome();
    }
    if (this.features.handlePush(push)) return;
    switch (push.type) {
      case 'event':
        if (push.sessionId !== this.sessionId) return;
        this.transcript = applyAgentEvent(this.transcript, push.event);
        this.refreshChrome();
        return;
      case 'permission/request':
        if (push.sessionId !== this.sessionId) return;
        this.queuePermission(push.requestId, push.action, push.detail);
        this.modals.pump();
        return;
      case 'permission/resolved':
        // Answered from another shell (Desktop, phone): drop our copy.
        this.modals.drop(`permission:${push.requestId}`);
        return;
      case 'extension/ui_request':
        if (push.sessionId !== this.sessionId) return;
        this.queueExtensionRequest(push);
        this.modals.pump();
        return;
      case 'session/name-updated':
        if (push.sessionId === this.sessionId) {
          this.sessionName = push.name;
          this.refreshChrome();
        }
        this.sessionSwitcher.refresh();
        return;
      case 'session/index-updated':
        this.sessionSwitcher.refresh();
        return;
      case 'session/context-updated':
        if (push.sessionId === this.sessionId) {
          this.context = push.snapshot;
          this.refreshChrome();
        }
        return;
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ modals

  private queuePermission(requestId: string, action: string, detail: string): void {
    this.modals.enqueue(`permission:${requestId}`, () =>
      this.modals.show(
        createPermissionModal({
          requestId,
          action,
          detail,
          inProject: this.sessionProjectId !== undefined,
          resolve: (command) => this.answerModal(command),
        }),
      ),
    );
  }

  private queueExtensionRequest(push: Extract<HostPush, { type: 'extension/ui_request' }>): void {
    const { requestId } = push;
    this.modals.enqueue(`extension:${requestId}`, () =>
      this.modals.show(
        createExtensionModal(push, (fields) =>
          this.answerModal({ type: 'extension/ui_resolve', requestId, ...fields }),
        ),
      ),
    );
  }

  private answerModal(command: HostCommand): void {
    this.modals.close();
    this.link.request(command).then(hostData, (error: unknown) => this.reportError(error));
  }

  // ------------------------------------------------------------------- input

  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (this.modals.isOpen) return undefined;
    const running = this.foreground.kind === 'active';
    if (matchesKey(data, Key.ctrl('c'))) {
      if (this.editingMessageId !== undefined) {
        this.editingMessageId = undefined;
        this.editor.setText('');
        this.flashHint('已取消改写');
      } else if (this.editor.getText().length > 0) {
        this.editor.setText('');
      } else if (this.sender.cancelWaiting()) {
        // Taken back into the composer; the hint says how many.
      } else if (running) {
        this.turns.abort().catch((error: unknown) => this.reportError(error));
      } else if (Date.now() - this.lastInterruptAt < EXIT_CONFIRM_WINDOW_MS) {
        this.options.onExit();
      } else {
        this.lastInterruptAt = Date.now();
        this.flashHint('再按一次 Ctrl+C 退出');
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.escape) && running && !this.editor.isShowingAutocomplete()) {
      this.turns.abort().catch((error: unknown) => this.reportError(error));
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('d')) && this.editor.getText().length === 0) {
      this.options.onExit();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('s')) && !this.options.embedded) {
      this.sessionSwitcher.open().catch((error: unknown) => this.reportError(error));
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('v'))) {
      this.attachments.pasteClipboardImage().catch((error: unknown) => this.reportError(error));
      return { consume: true };
    }
    if (matchesKey(data, Key.shift('tab'))) {
      this.composer.cyclePermissionPreset();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl('o'))) {
      this.flashHint(this.transcriptView.toggleToolOutput() ? '工具输出：完整' : '工具输出：摘要');
      this.tui.requestRender();
      return { consume: true };
    }
    return undefined;
  }

  // ------------------------------------------------------------------ chrome

  private async loadProjects(): Promise<void> {
    const data = hostData<{ projects?: RemoteProjectSummary[] }>(await this.link.request({ type: 'project/list' }));
    this.projects = data.projects ?? [];
  }

  private flashHint(text: string): void {
    if (this.statusHint !== undefined) clearTimeout(this.statusHint.timer);
    // Pushes redraw the status bar many times a second. A hint cleared inside
    // the redraw that displays it would never reach the screen, so the redraw
    // keeps the current hint and only this timer retires it.
    const timer = setTimeout(() => {
      this.statusHint = undefined;
      this.refreshChrome();
    }, STATUS_HINT_MS);
    timer.unref();
    this.statusHint = { text, timer };
    this.refreshChrome();
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.transcript = appendNotice(this.transcript, 'error', message);
    this.refreshChrome();
  }

  /** Push current state into the components and schedule a frame. */
  private refreshChrome(forceFullRedraw = false): void {
    this.transcriptView.setState(this.transcript);
    const running = this.foreground.kind === 'active';
    const hasLoader = this.activitySlot.children.length > 0;
    if (running) {
      const phase = this.foreground.kind === 'active' ? this.foreground.phase : undefined;
      this.loader.setMessage(`${describeRunPhase(phase)} · Esc 中断`);
      if (!hasLoader) {
        this.activitySlot.addChild(this.loader);
        this.loader.start();
      }
    } else if (hasLoader) {
      this.loader.stop();
      this.activitySlot.clear();
    }
    this.statusLine.setText(style.gray(this.describeStatus()));
    this.tui.terminal.setTitle(`piwin · ${this.sessionName ?? '新会话'}`);
    this.tui.requestRender(forceFullRedraw);
  }

  private describeStatus(): string {
    const scope =
      this.sessionProjectId === undefined
        ? '对话'
        : (this.projects.find((project) => project.projectId === this.sessionProjectId)?.displayName ?? '项目');
    const occupancy = this.context?.occupancy;
    const usage =
      occupancy?.kind === 'known' && occupancy.tokensLimit !== undefined
        ? `上下文 ${Math.round((occupancy.tokensUsed / occupancy.tokensLimit) * 100)}%`
        : undefined;
    return [
      this.statusHint?.text,
      this.sender.describe(),
      this.connected ? undefined : '重连中…',
      this.sessionName ?? (this.sessionId === undefined ? '新会话' : '未命名会话'),
      scope,
      ...this.composer.describe(),
      this.attachments.describe(),
      this.sideChat.describe(),
      ...this.features.describe(),
      this.editingMessageId === undefined ? undefined : '改写上一条提问 · Ctrl+C 取消',
      usage,
      this.options.mock ? 'mock' : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
  }
}
