import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  type TUI,
  type ScrollView,
  visibleWidth,
} from '@earendil-works/pi-tui';
import { formatTuiSessionAnnouncement } from '@piwin/contracts';
import type {
  HostPush,
  RemotePendingPermission,
  RemoteProjectSummary,
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
import { StatusLine, describeRunPhase, formatElapsed, type StatusLineContent } from './status-line.js';
import {
  EMPTY_TRANSCRIPT,
  appendNotice,
  mergeMissingUserMessages,
  startsTurnWithoutPrompt,
  appendNoticeOnce,
  applyAgentEvent,
  prependOlderMessages,
  settleStreaming,
  transcriptFromMessages,
  type TranscriptState,
} from './transcript-model.js';
import { TranscriptView } from './transcript-view.js';
import { createTuiControllers } from './tui-app-wiring.js';
import { TUI_COMMAND_NAMES, TUI_SLASH_COMMANDS, parseSlashCommand } from './tui-commands.js';
import { TuiComposerProfile } from './tui-composer-profile.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import { mountTuiLayout } from './tui-layout.js';
import { readTuiSessionIndex } from './tui-session-index.js';
import { StatusHint } from './status-hint.js';
import { QueryListOverlay } from './query-list-overlay.js';
import { describeHostFailure } from './host-failure-text.js';
import { editTextExternally } from './external-editor.js';
import { ComposerBadgeFrame } from './composer-badge-frame.js';
import { QueueStrip, stripRows } from './queue-strip.js';
import { handleQueueStripKey } from './queue-strip-keys.js';
import { TuiImageStore, openLatestImage } from './image-view.js';
import { openWithSystemBrowser } from './tui-artifact-controller.js';
import { PromptHistory } from './prompt-history.js';
import { DEFAULT_KEYBINDINGS, formatKey, type Keybindings } from './keybindings.js';
import {
  DEFAULT_STATUS_TEMPLATES,
  STATUS_GROUP_SEPARATOR,
  STATUS_PIECE_SEPARATOR,
  renderStatusLine,
  type StatusValues,
} from './status-template.js';
import { buildStatusMetricValues } from './status-values.js';
import { TuiGitBranch } from './tui-git-branch.js';
import type { TuiConfig } from './tui-config.js';
import { TurnNotifier } from './turn-notifier.js';
import { TuiGlobalKeys } from './tui-global-keys.js';
import { TuiHostPrompts } from './tui-host-prompts.js';
import { TuiModalStack } from './tui-modals.js';
import { TuiPromptSender } from './tui-prompt-sender.js';
import { TuiSessionFeatures } from './tui-session-features.js';
import { TuiSessionSwitcher } from './tui-session-switcher.js';
import { TuiSideChatController } from './tui-side-chat-controller.js';
import { TuiTurnActions } from './tui-turn-actions.js';
import { TuiRewindController } from './tui-rewind-controller.js';
import { TuiUsageController } from './tui-usage-controller.js';
import { ProjectFiles } from './project-files.js';
import type { FileOpener, TuiArtifactController } from './tui-artifact-controller.js';
import { countTranscriptArtifacts } from './artifact-export.js';
import { existsSync } from 'node:fs';
import { TuiAttachmentController } from './tui-attachment-controller.js';
import { TuiAutocompleteProvider } from './tui-autocomplete.js';
import { editorTheme, style } from './tui-theme.js';

const TRANSCRIPT_PAGE_ITEMS = 50;
const FOREIGN_PROMPT_PAGE_ITEMS = 6;
const TRANSCRIPT_PAGE_BYTES = 256 * 1024;

export type TuiAppOptions = {
  tui: TUI;
  link: TuiHostLink;
  /** Open this session at start. */
  sessionId?: string;
  /** Scope for sessions created here; absent means the general workspace. */
  projectId?: string;
  /** Desktop-embedded pane: pinned to one session, Desktop's sidebar switches. */
  embedded: boolean;
  /** Open the session picker once after start (e.g. bare `--resume`). */
  openSessionPicker?: boolean;
  mock: boolean;
  /** Something the launch has to tell the user, shown once above the composer. */
  startNotice?: string;
  onExit: () => void;
  /** Keys and status line from the person's own settings; defaults when absent. */
  config?: Partial<Pick<TuiConfig, 'keybindings' | 'statusTemplates' | 'showCost'>>;
  /** External agent for new sessions (`--agent`); Pi when absent. */
  agentId?: string;
  /** Where this project's sent prompts are kept; absent keeps them for this run only. */
  historyFile?: string;
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
  private readonly images: TuiImageStore;
  private readonly transcriptScroll: ScrollView | undefined;
  private openingSession = false;
  private readonly activitySlot = new Container();
  private readonly editor: Editor;
  private readonly queueStrip = new QueueStrip(() =>
    stripRows(this.features.queue.pendingTurns(), this.features.interventions.list()),
  );
  private readonly statusLine = new StatusLine();
  private readonly loader: Loader;
  /** When the in-flight turn began; drives the elapsed counter on the activity line. */
  private turnStartedAt: number | undefined;
  private elapsedTimer: ReturnType<typeof setInterval> | undefined;
  private subagentTimer: ReturnType<typeof setInterval> | undefined;

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
  private readonly usage: TuiUsageController;
  private readonly rewind: TuiRewindController;
  private readonly sender: TuiPromptSender;
  private readonly runCommand: (name: string, argument: string) => Promise<void>;
  private readonly artifacts: TuiArtifactController;
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
  private readonly statusHint = new StatusHint(() => this.refreshChrome());
  private readonly gitBranch = new TuiGitBranch(() => this.refreshChrome());
  private gitBranchRoot: string | undefined;

  private readonly modals: TuiModalStack;
  private readonly prompts: TuiHostPrompts;
  private readonly history: PromptHistory;
  /** Backend the next new session gets; absent is Pi. */
  private draftAgentId: string | undefined;
  /** Backend of the session on screen; absent is Pi. */
  private sessionAgentId: string | undefined;
  private sessionArchived = false;
  private readonly keybindings: Keybindings;
  private readonly notifier: TurnNotifier;
  private readonly globalKeys: TuiGlobalKeys;
  private readonly sessionSwitcher: TuiSessionSwitcher;
  private readonly disposers: Array<() => void> = [];

  public constructor(private readonly options: TuiAppOptions) {
    this.tui = options.tui;
    this.keybindings = options.config?.keybindings ?? DEFAULT_KEYBINDINGS;
    this.link = options.link;
    this.openingSession = options.sessionId !== undefined;
    this.projectId = options.projectId;
    this.transcriptView = new TranscriptView(options.embedded);
    this.images = new TuiImageStore({
      link: options.link,
      getSessionId: () => this.sessionId,
      onLoaded: () => {
        this.transcriptView.invalidate();
        this.tui.requestRender();
      },
      write: (data) => this.tui.terminal.write(data),
    });
    this.transcriptView.setImageRenderer((images, width) => this.images.render(images, width));
    // Kitty pictures stay where they were placed; drop them before a resize reflows the screen.
    if (process.stdout.isTTY) process.stdout.on('resize', () => this.images.clearScreenImages());
    this.editor = new Editor(this.tui, editorTheme, { paddingX: 1 });
    this.editor.onSubmit = (text) => {
      this.submit(text).catch((error: unknown) => this.reportError(error));
    };
    this.sessionProjectId = options.projectId;
    this.notifier = new TurnNotifier({ write: (data) => this.tui.terminal.write(data) });
    this.draftAgentId = options.agentId === 'pi' ? undefined : options.agentId;
    this.sessionAgentId = this.draftAgentId;
    this.history = new PromptHistory(options.historyFile);
    for (const entry of this.history.all()) this.editor.addToHistory(entry);
    this.files = new ProjectFiles({
      request: (command) => this.link.request(command),
      getProjectId: () => this.sessionProjectId,
    });
    this.loader = new Loader(this.tui, style.cyan, style.gray, '');
    this.modals = new TuiModalStack(this.tui, this.editor, () => this.sessionSwitcher.handleOverlayClosed());
    this.prompts = new TuiHostPrompts({
      link: this.link,
      modals: this.modals,
      getPathRoots: () => this.currentProjectRoots(),
      isInProject: () => this.sessionProjectId !== undefined,
      onAttention: (message) => this.notifier.attention(message),
      onError: (error) => this.reportError(error),
    });
    const controllers = createTuiControllers({
      images: this.images,
      getProjectRoot: () => this.currentProjectRoots().find((root) => existsSync(root)),
      tui: this.tui,
      editor: this.editor,
      link: this.link,
      modals: this.modals,
      files: this.files,
      embedded: options.embedded,
      keybindings: this.keybindings,
      ...(options.openFile === undefined ? {} : { openFile: options.openFile }),
      getSessionId: () => this.sessionId,
      getRunId: () => knownForegroundRunId(this.foreground),
      getAgentId: () => this.sessionAgentId,
      getTranscript: () => this.transcript,
      updateTranscript: (update) => {
        this.transcript = update(this.transcript);
      },
      getProjects: () => this.projects,
      getContext: () => this.context,
      getConversation: () => this.conversation,
      getEditingMessageId: () => this.editingMessageId,
      setEditingMessageId: (messageId) => {
        this.editingMessageId = messageId;
      },
      isRunning: () => this.isRunning(),
      ensureSession: () => this.ensureSession(),
      openSession: (sessionId) => this.openSession(sessionId),
      startDraftSession: (agentId) => this.startDraftSession(agentId),
      onTurnAccepted: async (sessionId) => {
        if (this.isRunning() || sessionId !== this.sessionId) return;
        // Show activity immediately; the run/updated push supplies the real run id.
        await this.reconcileForegroundRun(sessionId, this.sessionEpoch);
        this.refreshChrome();
      },
      renameSession: (sessionId, name) => this.renameSession(sessionId, name),
      renameCurrentSession: (name) => this.renameCurrentSession(name),
      loadOlderMessages: () => this.loadOlderMessages(),
      rememberPrompt: (text) => this.rememberPrompt(text),
      refresh: () => this.refreshChrome(),
      hint: (text) => this.flashHint(text),
      error: (error) => this.reportError(error),
      exit: () => options.onExit(),
      prompts: this.prompts,
    });
    this.composer = controllers.composer;
    this.attachments = controllers.attachments;
    this.features = controllers.features;
    this.sideChat = controllers.sideChat;
    this.turns = controllers.turns;
    this.usage = controllers.usage;
    this.rewind = controllers.rewind;
    this.sender = controllers.sender;
    this.sessionSwitcher = controllers.sessionSwitcher;
    this.runCommand = controllers.runCommand;
    this.artifacts = controllers.artifacts;
    this.transcriptScroll = mountTuiLayout(this.tui, {
      transcript: this.transcriptView, activity: this.activitySlot, strip: this.queueStrip,
      editor: new ComposerBadgeFrame(this.editor, () => (this.sessionAgentId === undefined ? this.composer.activeSchemeName() : undefined)),
      status: this.statusLine,
    });
    this.globalKeys = new TuiGlobalKeys({
      editor: this.editor,
      embedded: options.embedded,
      keybindings: this.keybindings,
      isModalOpen: () => this.modals.isOpen,
      isRunning: () => this.isRunning(),
      isEditingTurn: () => this.editingMessageId !== undefined,
      cancelEditingTurn: () => {
        this.editingMessageId = undefined;
      },
      cancelWaitingMessages: () => this.sender.cancelWaiting(),
      abortTurn: () => {
        this.turns.abort().catch((error: unknown) => this.reportError(error));
      },
      exit: () => options.onExit(),
      openSessions: () => {
        this.sessionSwitcher.open().catch((error: unknown) => this.reportError(error));
      },
      pasteClipboardImage: () => {
        this.attachments.pasteClipboardImage().catch((error: unknown) => this.reportError(error));
      },
      cyclePermissionPreset: () => this.composer.cyclePermissionPreset(),
      openHistorySearch: () => this.openHistorySearch(),
      openRewind: () => this.rewind.open(),
      editInExternalEditor: () => this.editInExternalEditor(),
      toggleToolOutput: () => this.transcriptView.toggleToolOutput(),
      openLatestArtifact: () => this.artifacts.openLatest(),
      openLatestImage: () => {
        openLatestImage({
          store: this.images,
          transcript: this.transcript,
          open: this.options.openFile ?? openWithSystemBrowser,
          hint: (text) => {
            this.flashHint(text);
            this.refreshChrome();
          },
          notice: (tone, text) => {
            this.transcript = appendNotice(this.transcript, tone, text);
            this.refreshChrome();
          },
        }).catch((error: unknown) => this.reportError(error));
      },
      handleStripKey: (data, focusRequested) =>
        handleQueueStripKey(this.queueStrip, data, focusRequested, {
          queue: this.features.queue,
          interventions: this.features.interventions,
          refresh: () => this.refreshChrome(),
          onError: (error) => this.reportError(error),
        }),
      hint: (text) => this.flashHint(text),
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
      this.tui.addInputListener((data) => this.globalKeys.handle(data)),
    );
    this.tui.start();
    this.refreshChrome();
    const profileErrors: unknown[] = [];
    const recordProfileError = (error: unknown): void => { profileErrors.push(error); };
    const projects = this.loadProjects().catch(recordProfileError);
    await Promise.all([
      Promise.all([
        projects,
        this.composer.loadModels().catch(recordProfileError),
        this.composer.loadHostPermissionPreset().catch(recordProfileError),
        this.composer.loadPromptTemplates().catch(recordProfileError),
      ]).then(() => {
        this.rebuildAutocomplete();
        this.refreshChrome();
      }),
      this.options.sessionId !== undefined
        ? this.openSession(this.options.sessionId)
        : this.options.openSessionPicker === true && !this.options.embedded
          ? projects.then(() => this.sessionSwitcher.open())
          : Promise.resolve(),
    ]);
    for (const error of profileErrors) this.reportError(error);
    if (this.options.startNotice !== undefined) {
      // After the session opened: opening replaces the transcript.
      this.transcript = appendNotice(this.transcript, 'info', this.options.startNotice);
    }
    this.refreshChrome();
  }

  public dispose(): void {
    this.statusHint.dispose();
    this.usage.dispose();
    this.stopElapsedTimer();
    if (this.subagentTimer !== undefined) clearInterval(this.subagentTimer);
    this.subagentTimer = undefined;
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
    this.openingSession = true;
    this.foreground = { kind: 'reconciling', generation: (this.foregroundGeneration += 1) };
    if (previous.sessionId !== sessionId) {
      this.features.reset();
      this.composer.resetSchemeForNewSession();
      this.images.reset();
    }
    try {
      await this.link.client.updateSubscriptions([sessionId]);
      // Subscribe first, then resume and look up metadata together. The history
      // can be drawn as soon as it arrives, while the index is still loading.
      const [resume, indexed] = await Promise.all([
        this.link.request({ type: 'session/resume', sessionId }).then((response) => {
          const snapshot = hostData<RemoteSessionResumeData>(response);
          if (epoch === this.sessionEpoch) {
            this.sessionId = sessionId;
            this.sessionName = snapshot.name;
            this.transcript = transcriptFromMessages(snapshot.messages);
            this.olderCursor = snapshot.transcriptPage?.olderCursor;
            this.context = snapshot.contextSnapshot;
            this.usage.reset(snapshot.lastRequestUsage);
            if (snapshot.model !== undefined) this.composer.adoptSessionModel(snapshot.model);
            this.editingMessageId = undefined;
            if (previous.sessionId !== sessionId) this.transcriptScroll?.scrollToEnd();
            this.transcriptView.invalidate();
            this.refreshChrome(true);
          }
          return snapshot;
        }),
        readTuiSessionIndex(this.link, sessionId),
      ]);
      if (epoch !== this.sessionEpoch) return;
      this.sessionProjectId =
        resume.scope === 'project'
          ? (indexed?.projectId ??
            // A side chat is not in the session index; it lives in its source's project.
            (this.sideChat.sourceSessionOf(sessionId) === previous.sessionId ? previous.projectId : undefined))
          : undefined;
      this.sessionAgentId = indexed?.agentId;
      this.sessionArchived = indexed?.archived === true;
      this.modals.clearQueue();
      await Promise.all([
        this.features.load(sessionId),
        Promise.all([
          this.reconcileForegroundRun(sessionId, epoch),
          this.loadPendingPermissions(sessionId, epoch),
        ]).then(() => {
          if (epoch !== this.sessionEpoch) return;
          // Input is safe once target/foreground/permissions are known. Auxiliary
          // feature reads must not keep a usable conversation behind a spinner.
          this.openingSession = false;
          this.announceSession(sessionId);
          this.refreshChrome();
          this.modals.pump();
        }),
      ]);
      if (epoch === this.sessionEpoch) this.refreshChrome();
    } catch (error) {
      if (epoch === this.sessionEpoch) {
        this.openingSession = false;
        this.refreshChrome();
      }
      throw error;
    }
  }

  /** Requests raised before this shell opened the session (or while it was offline). */
  private async loadPendingPermissions(sessionId: string, epoch: number): Promise<void> {
    const data = hostData<{ permissions?: RemotePendingPermission[] }>(
      await this.link.request({ type: 'permission/pending-list' }),
    );
    if (epoch !== this.sessionEpoch) return;
    for (const pending of data.permissions ?? []) {
      if (pending.sessionId === sessionId) {
        this.prompts.askPermission(pending);
      }
    }
  }

  /** `agentId` picks the backend of the session this draft becomes; absent keeps the launch choice. */
  /** Embedded in Desktop's terminal: say which session is on screen, so Desktop follows it. */
  private announceSession(sessionId: string): void {
    if (this.options.embedded) this.tui.terminal.write(formatTuiSessionAnnouncement(sessionId));
  }

  /** The open session was archived, restored or deleted from another shell. */
  private followIndexChange(sessionId: string, op: string): void {
    if (sessionId !== this.sessionId) return;
    if (op === 'archived' || op === 'unarchived') {
      this.sessionArchived = op === 'archived';
      this.refreshChrome();
    } else if (op === 'deleted') {
      this.startDraftSession();
      this.transcript = appendNotice(this.transcript, 'info', '这个会话在别处被删除了，已回到新会话');
      this.refreshChrome(true);
    }
  }

  /** An answer began with no prompt before it: another shell sent it, and its text is only in the durable page. */
  private fetchForeignPrompt(sessionId: string): void {
    const epoch = this.sessionEpoch;
    this.link
      .request({
        type: 'session/transcript-page',
        query: { sessionId, limit: FOREIGN_PROMPT_PAGE_ITEMS, maximumBytes: TRANSCRIPT_PAGE_BYTES },
      })
      .then((response) => {
        if (epoch !== this.sessionEpoch || !response.success) return;
        const page = response.data as RemoteSessionTranscriptPageData;
        if (page.status !== 'page') return;
        this.transcript = mergeMissingUserMessages(this.transcript, page.messages);
        this.transcriptView.invalidate();
        this.refreshChrome();
      })
      .catch((error: unknown) => this.reportError(error));
  }

  private startDraftSession(agentId?: string): void {
    this.openingSession = false;
    this.transcriptScroll?.scrollToEnd();
    this.draftAgentId = agentId === undefined ? this.options.agentId : agentId === 'pi' ? undefined : agentId;
    this.sessionAgentId = this.draftAgentId;
    this.sessionArchived = false;
    this.sessionEpoch += 1;
    this.conversation = {};
    this.sessionId = undefined;
    this.sessionName = undefined;
    this.sessionProjectId = this.projectId;
    this.features.reset();
    this.composer.resetSchemeForNewSession();
    this.images.reset();
    this.usage.reset(null);
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
    if (this.openingSession) return Promise.reject(new Error('会话正在加载，请稍候再操作'));
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
          ...(this.draftAgentId === undefined ? (model === undefined ? {} : { model }) : { agentId: this.draftAgentId }),
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
    this.sessionAgentId = this.draftAgentId;
    this.sessionArchived = false;
    this.announceSession(created.sessionId);
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
    if (this.openingSession) {
      this.editor.setText(rawText);
      this.flashHint('会话正在加载，请稍候再发送');
      return;
    }
    this.editor.setText('');
    this.transcriptScroll?.scrollToEnd();
    const command = parseSlashCommand(typedText);
    if (command !== undefined) {
      await this.runCommand(command.name, command.argument);
      return;
    }
    this.rememberPrompt(typedText);
    await this.sender.send(rawText, false);
  }

  private rememberPrompt(text: string): void {
    this.editor.addToHistory(text.trim());
    this.history.add(text);
  }

  /** Ctrl+G: give the terminal to `$EDITOR` for the composer text, then take it back. */
  private editInExternalEditor(): void {
    const result = (() => {
      this.tui.stop();
      try {
        // Pasted blocks are folded in the composer; the editor should see all of it.
        return editTextExternally(this.editor.getExpandedText());
      } finally {
        this.tui.start();
        this.tui.requestRender(true);
      }
    })();
    if (result.kind === 'edited') this.editor.setText(result.text);
    else if (result.kind === 'failed') this.flashHint(result.reason);
  }

  private openHistorySearch(): void {
    const { modals } = this;
    modals.show(
      new QueryListOverlay<string>({
        title: '历史提示词',
        footer: '↑↓ 选择 · Enter 填入输入框 · Esc 取消',
        emptyHint: '还没有发送过的提示词',
        noMatchHint: '没有匹配的提示词',
        search: (query) => this.history.search(query),
        label: (text) => text,
        onPick: (text) => {
          modals.close();
          this.editor.setText(text);
          this.tui.requestRender();
        },
        onCancel: () => modals.close(),
      }),
    );
  }

  /** The session this shell shows, once it has one. */
  public currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Whether the Host reports the open session as archived (read by tests and status). */
  public isSessionArchived(): boolean {
    return this.sessionArchived;
  }

  /** The status line as last set (styled). */
  public statusText(): string {
    return this.statusLine.getText();
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
    if (this.features.handlePush(push) || this.usage.handlePush(push)) return;
    switch (push.type) {
      case 'event':
        if (push.sessionId !== this.sessionId) return;
        if (startsTurnWithoutPrompt(this.transcript, push.event)) this.fetchForeignPrompt(push.sessionId);
        this.transcript = applyAgentEvent(this.transcript, push.event);
        this.refreshChrome();
        return;
      case 'permission/request':
        if (push.sessionId !== this.sessionId) return;
        this.prompts.askPermission(push);
        this.modals.pump();
        return;
      case 'permission/resolved':
        // Answered from another shell (Desktop, phone): drop our copy.
        this.prompts.permissionResolvedElsewhere(push.requestId);
        return;
      case 'extension/ui_request':
        if (push.sessionId !== this.sessionId) return;
        this.prompts.askExtension(push);
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
        this.followIndexChange(push.sessionId, push.op);
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

  // ------------------------------------------------------------------ chrome

  private async loadProjects(): Promise<void> {
    const data = hostData<{ projects?: RemoteProjectSummary[] }>(await this.link.request({ type: 'project/list' }));
    this.projects = data.projects ?? [];
  }

  private flashHint(text: string): void {
    this.statusHint.show(text);
  }

  private reportError(error: unknown): void {
    const message = describeHostFailure(error instanceof Error ? error.message : String(error));
    this.transcript = appendNotice(this.transcript, 'error', message);
    this.refreshChrome();
  }

  /** Push current state into the components and schedule a frame. */
  private refreshChrome(forceFullRedraw = false): void {
    this.transcriptView.setState(this.transcript);
    this.transcriptView.setPathRoots(this.currentProjectRoots());
    this.syncSubagentRuns();
    const running = this.foreground.kind === 'active';
    this.notifier.observeRunning(running);
    const hasLoader = this.activitySlot.children.length > 0;
    if (running) {
      const phase = this.foreground.kind === 'active' ? this.foreground.phase : undefined;
      if (this.turnStartedAt === undefined) this.startElapsedTimer();
      this.loader.setMessage(this.describeActivity(phase));
      if (!hasLoader) {
        this.activitySlot.addChild(this.loader);
        this.loader.start();
      }
    } else {
      this.stopElapsedTimer();
      if (hasLoader) {
        this.loader.stop();
        this.activitySlot.clear();
      }
    }
    // A turn may have switched branches; a new session may be another repo.
    this.syncGitBranch(hasLoader && !running);
    if (this.openingSession) this.statusLine.setText(style.gray('正在加载会话…'));
    else this.statusLine.setContent(this.describeStatus());
    this.tui.terminal.setTitle(`piwin · ${this.sessionName ?? '新会话'}`);
    this.tui.requestRender(forceFullRedraw);
  }

  private describeActivity(phase: string | undefined): string {
    const elapsed = this.turnStartedAt === undefined ? 0 : Date.now() - this.turnStartedAt;
    return `${describeRunPhase(phase)} · ${formatElapsed(elapsed)} · Esc 中断`;
  }

  /** Tick the activity line once a second for the turn in flight. */
  private startElapsedTimer(): void {
    this.stopElapsedTimer();
    this.turnStartedAt = Date.now();
    this.elapsedTimer = setInterval(() => {
      if (this.foreground.kind !== 'active') {
        this.stopElapsedTimer();
        return;
      }
      this.loader.setMessage(this.describeActivity(this.foreground.phase));
      if (!this.openingSession) this.statusLine.setContent(this.describeStatus());
      this.tui.requestRender();
    }, 1000);
    // Never keep the process alive just for the counter.
    this.elapsedTimer.unref?.();
  }

  private stopElapsedTimer(): void {
    if (this.elapsedTimer !== undefined) clearInterval(this.elapsedTimer);
    this.elapsedTimer = undefined;
    this.turnStartedAt = undefined;
  }

  private syncGitBranch(force: boolean): void {
    const root = this.currentProjectRoots()[0];
    if (!force && root === this.gitBranchRoot) return;
    this.gitBranchRoot = root;
    void this.gitBranch.refresh(root);
  }

  /** Roots the current session's tool paths are shown relative to. */
  private currentProjectRoots(): string[] {
    const project = this.projects.find((candidate) => candidate.projectId === this.sessionProjectId);
    return [project?.path, project?.gitRootPath].filter((root): root is string => root !== undefined);
  }

  /** Live subagent rows; while any runs, their elapsed counters redraw once a second. */
  private syncSubagentRuns(): void {
    const subagents = this.features.subagents;
    const running = subagents.hasRunningInvocations();
    const second = running ? Math.floor(Date.now() / 1000) : 0;
    this.transcriptView.setSubagentRuns(subagents.lookupRun, subagents.liveVersion * 100_000 + (second % 100_000), subagents.lookupRunByToolCall);
    if (running && this.subagentTimer === undefined) {
      this.subagentTimer = setInterval(() => this.refreshChrome(), 1000);
      this.subagentTimer.unref?.();
    } else if (!running && this.subagentTimer !== undefined) {
      clearInterval(this.subagentTimer);
      this.subagentTimer = undefined;
    }
  }

  private describeArtifacts(): string | undefined {
    const count = countTranscriptArtifacts(this.transcript);
    return count === 0 ? undefined : `◆ ${count} 个 artifact · ${formatKey(this.keybindings.openArtifact)} 打开最新`;
  }

  private describeStatus(): StatusLineContent {
    const scope =
      this.sessionProjectId === undefined
        ? '对话'
        : (this.projects.find((project) => project.projectId === this.sessionProjectId)?.displayName ?? '项目');
    const [model, thinking, permission, skill, scheme] = this.composer.describe();
    const activity = this.features.describe().filter((part): part is string => part !== undefined);
    // What needs attention gets its own line; the template only arranges the rest.
    const alerts = [
      this.statusHint.text,
      this.sender.describe(),
      this.connected ? undefined : style.yellow('⚠ 重连中…'),
      this.sessionArchived ? '已归档 · /unarchive 恢复' : undefined,
      this.attachments.describe(),
      this.sideChat.describe(),
      this.editingMessageId === undefined ? undefined : '改写上一条提问 · Ctrl+C 取消',
      this.describeArtifacts(),
    ].filter((part): part is string => part !== undefined && part.length > 0);
    const native = this.sessionAgentId === undefined;
    const running = this.foreground.kind === 'active'
      ? { phase: this.foreground.phase, elapsedMs: this.turnStartedAt === undefined ? 0 : Date.now() - this.turnStartedAt }
      : undefined;
    const values: StatusValues = {
      session: this.sessionName ?? (this.sessionId === undefined ? '新会话' : '未命名会话'),
      project: scope,
      branch: this.gitBranch.current() === undefined ? undefined : style.gray(`⎇ ${this.gitBranch.current()}`),
      agent: this.sessionAgentId,
      model: native ? model : undefined,
      thinking: native ? thinking : undefined,
      permission: native ? (permission === 'YOLO' ? style.bold(style.yellow(permission)) : permission) : undefined,
      scheme: native ? scheme : undefined,
      skill,
      activity: activity.length === 0 ? undefined : activity.join(' · '),
      mock: this.options.mock ? style.gray('mock') : undefined,
      ...buildStatusMetricValues({
        metrics: this.usage.metrics(),
        style,
        running,
        compacting: this.context?.phase === 'compacting',
        showCost: this.options.config?.showCost === true,
      }),
    };
    const templates = this.options.config?.statusTemplates ?? DEFAULT_STATUS_TEMPLATES;
    const separators = { piece: style.gray(STATUS_PIECE_SEPARATOR), group: style.gray(STATUS_GROUP_SEPARATOR) };
    return {
      alerts,
      line: (width) => renderStatusLine({ templates, values, width, measure: visibleWidth, separators }),
    };
  }
}
