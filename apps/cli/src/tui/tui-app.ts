import { randomUUID } from 'node:crypto';
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
import { StatusLine } from './status-line.js';
import {
  EMPTY_TRANSCRIPT,
  appendLocalUserMessage,
  appendNotice,
  applyAgentEvent,
  prependOlderMessages,
  settleStreaming,
  transcriptFromMessages,
  type TranscriptState,
} from './transcript-model.js';
import { TranscriptView } from './transcript-view.js';
import { TUI_COMMAND_NAMES, TUI_SLASH_COMMANDS, parseSlashCommand } from './tui-commands.js';
import { findLastUserMessageId } from './tui-composer-options.js';
import { TuiComposerProfile } from './tui-composer-profile.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import { TuiModalStack, createExtensionModal, createPermissionModal } from './tui-modals.js';
import { TuiPlanController } from './tui-plan-controller.js';
import { TuiSessionSwitcher } from './tui-session-switcher.js';
import { ProjectFiles } from './project-files.js';
import { TuiAttachmentController } from './tui-attachment-controller.js';
import { TuiAutocompleteProvider } from './tui-autocomplete.js';
import { editorTheme, style } from './tui-theme.js';

const SESSION_LOOKUP_LIMIT = 500;
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
  onExit: () => void;
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
  private sessionName: string | undefined;
  private olderCursor: string | undefined;
  private projectId: string | undefined;
  /** Project of the session on screen: what `@` mentions are resolved against. */
  private sessionProjectId: string | undefined;
  private readonly files: ProjectFiles;
  private readonly attachments: TuiAttachmentController;
  private readonly plans: TuiPlanController;
  private projects: RemoteProjectSummary[] = [];
  private readonly composer: TuiComposerProfile;
  private context: SessionContextSnapshot | undefined;
  private foreground: ForegroundRunState = initialForegroundRunState();
  private foregroundGeneration = 0;
  /** Bumped on every session switch so late responses for the old session are dropped. */
  private sessionEpoch = 0;
  private connected = true;
  private statusHint: string | undefined;
  private lastInterruptAt = 0;

  private readonly modals: TuiModalStack;
  private readonly sessionSwitcher: TuiSessionSwitcher;
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
    this.plans = new TuiPlanController({
      link: this.link,
      modals: this.modals,
      getSessionId: () => this.sessionId,
      onChanged: () => this.refreshChrome(),
      onHint: (text) => this.flashHint(text),
      onNotice: notify,
      onError: (error) => this.reportError(error),
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
      requestRender: () => this.tui.requestRender(),
    });
    this.tui.addChild(this.transcriptView);
    this.tui.addChild(this.activitySlot);
    this.tui.addChild(this.editor);
    this.tui.addChild(this.statusLine);
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
    } else {
      this.refreshChrome();
    }
  }

  public dispose(): void {
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
    await this.link.client.updateSubscriptions([sessionId]);
    const resume = hostData<RemoteSessionResumeData>(
      await this.link.request({ type: 'session/resume', sessionId }),
    );
    if (epoch !== this.sessionEpoch) return;
    this.sessionId = sessionId;
    this.sessionName = resume.name;
    this.sessionProjectId =
      resume.scope === 'project' ? await this.lookUpSessionProjectId(sessionId) : undefined;
    if (epoch !== this.sessionEpoch) return;
    this.transcript = transcriptFromMessages(resume.messages);
    this.olderCursor = resume.transcriptPage?.olderCursor;
    this.context = undefined;
    if (resume.model !== undefined) this.composer.adoptSessionModel(resume.model);
    this.modals.clearQueue();
    await this.reconcileForegroundRun(sessionId, epoch);
    await this.plans.load(sessionId);
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
    this.sessionId = undefined;
    this.sessionName = undefined;
    this.sessionProjectId = this.projectId;
    this.plans.reset();
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
    this.foreground = { kind: 'reconciling', generation };
    const response = await this.link.request({ type: 'session/foreground-run', sessionId });
    if (epoch !== this.sessionEpoch) return;
    this.foreground = applyForegroundRunResponse(this.foreground, response, generation, sessionId);
    if (this.foreground.kind !== 'active') {
      this.foreground = { kind: 'idle', generation };
      this.transcript = settleStreaming(this.transcript);
    }
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId !== undefined) return this.sessionId;
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
      await this.runSlashCommand(command.name, command.argument);
      return;
    }
    this.editor.addToHistory(rawText.trim());
    if (this.attachments.isUploading) {
      this.editor.setText(rawText);
      this.flashHint('附件还在上传，稍后再发');
      return;
    }
    const sessionId = await this.ensureSession();
    const clientMessageId = randomUUID();
    const runId = knownForegroundRunId(this.foreground);
    // A message that joins a running turn travels as plain text: attachments
    // and file refs wait for a turn of their own.
    const text = runId === undefined ? await this.attachments.adoptDroppedImages(sessionId, typedText) : typedText;
    const attached = runId === undefined ? this.attachments.take() : [];
    const mentions =
      runId === undefined
        ? await this.files.resolveMentions(text)
        : { refs: [], unresolved: [], overLimit: [] };
    this.transcript = appendLocalUserMessage(
      this.transcript,
      clientMessageId,
      text,
      [
        ...mentions.refs.map((ref) => `@${ref.label}${ref.kind === 'folder' ? '/' : ''}`),
        ...attached.map((entry) => `附件 ${entry.label}`),
      ],
    );
    if (mentions.overLimit.length > 0) {
      this.transcript = appendNotice(
        this.transcript,
        'error',
        `一条消息最多引用 ${mentions.refs.length} 个文件，未带上：${mentions.overLimit.join('、')}`,
      );
    }
    this.refreshChrome();
    if (mentions.unresolved.length > 0) {
      this.flashHint(`项目里没有 ${mentions.unresolved.map((path) => `@${path}`).join('、')}，按普通文字发送`);
    }
    if (runId !== undefined) {
      // A run is in flight: the text joins it at the next step instead of queueing a new turn.
      hostData(
        await this.link.request({ type: 'session/steer', sessionId, message: text, runId, clientMessageId }),
      );
      if (this.attachments.describe() !== undefined) this.flashHint('附件会随下一轮消息发送');
      return;
    }
    const skillId = this.composer.takeSkillId();
    const response = await this.link.request({
      type: 'session/prompt',
      sessionId,
      input: {
        text,
        clientMessageId,
        ...(attached.length === 0 ? {} : { attachments: attached.map((entry) => entry.attachment) }),
        ...(skillId === undefined ? {} : { skillId }),
        ...(mentions.refs.length === 0 ? {} : { contextRefs: mentions.refs }),
        ...this.composer.promptFields(),
      },
      foreground: { kind: 'if-idle' },
    });
    // A refused prompt keeps its uploads: the user fixes the cause and resends.
    if (!response.success) this.attachments.restore(attached);
    hostData(response);
    if (this.foreground.kind !== 'active') {
      // Show activity immediately; the run/updated push supplies the real run id.
      await this.reconcileForegroundRun(sessionId, this.sessionEpoch);
      this.refreshChrome();
    }
  }

  private async abortRun(): Promise<void> {
    if (this.sessionId === undefined) return;
    const runId = knownForegroundRunId(this.foreground);
    hostData(
      await this.link.request({
        type: 'session/abort',
        sessionId: this.sessionId,
        ...(runId === undefined ? {} : { runId }),
      }),
    );
  }

  private async runSlashCommand(name: string, argument: string): Promise<void> {
    const embeddedOnlyBlocked = this.options.embedded && (name === 'sessions' || name === 'new');
    if (embeddedOnlyBlocked) {
      this.flashHint('内嵌模式下请用 Desktop 侧栏切换会话');
      return;
    }
    switch (name) {
      case 'sessions':
        await this.sessionSwitcher.open();
        return;
      case 'new':
        this.startDraftSession();
        return;
      case 'model':
        this.composer.openModelPicker();
        return;
      case 'older':
        await this.loadOlderMessages();
        return;
      case 'thinking':
        this.composer.openThinkingPicker();
        return;
      case 'permission':
        this.composer.openPermissionPicker();
        return;
      case 'skill':
        await this.composer.openSkillPicker();
        return;
      case 'prompts':
        this.composer.openPromptPicker(TUI_COMMAND_NAMES, (name) => {
          this.editor.setText(`/${name} `);
          this.tui.requestRender();
        });
        return;
      case 'plan':
        this.plans.open();
        return;
      case 'compact':
        await this.compactSession(argument);
        return;
      case 'attach':
        await this.attachments.attachPaths(argument);
        return;
      case 'paste':
        await this.attachments.pasteClipboardImage();
        return;
      case 'detach':
        this.attachments.detach();
        return;
      case 'retry':
        await this.retryLastTurn();
        return;
      case 'rename': {
        if (this.sessionId === undefined) {
          this.flashHint('当前还没有会话');
          return;
        }
        if (argument.length > 0) {
          await this.renameSession(this.sessionId, argument);
          return;
        }
        const sessionId = this.sessionId;
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
        return;
      }
      case 'help':
        this.transcript = appendNotice(
          this.transcript,
          'info',
          [
            ...TUI_SLASH_COMMANDS.map((command) => `/${command.name}  ${command.description}`),
            'Ctrl+S 会话 · Shift+Tab 权限模式 · Ctrl+V 粘贴图片 · @ 引用文件 · Ctrl+O 展开工具输出 · Esc 中断 · Ctrl+C 两次退出 · Shift+Enter 换行',
          ].join('\n'),
        );
        this.refreshChrome();
        return;
      case 'quit':
        this.options.onExit();
        return;
      default:
        this.flashHint(`未知命令 /${name}，/help 查看可用命令`);
    }
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
          this.transcript = appendNotice(this.transcript, 'error', push.run.error);
        }
      }
      this.refreshChrome();
    }
    if (this.plans.handlePush(push)) return;
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

  private async compactSession(customInstructions: string): Promise<void> {
    if (this.sessionId === undefined) {
      this.flashHint('当前还没有会话');
      return;
    }
    if (this.foreground.kind === 'active') {
      this.flashHint('运行中不能压缩，先按 Esc 中断');
      return;
    }
    // Progress and the outcome arrive as compaction/start and compaction/end events.
    hostData(
      await this.link.request({
        type: 'session/compact',
        sessionId: this.sessionId,
        ...(customInstructions.length === 0 ? {} : { customInstructions }),
      }),
    );
  }

  /** Re-run the last user turn in place; the Host drops the previous answer. */
  private async retryLastTurn(): Promise<void> {
    const retryUserMessageId = findLastUserMessageId(this.transcript);
    if (this.sessionId === undefined || retryUserMessageId === undefined) {
      this.flashHint('没有可以重试的消息');
      return;
    }
    if (this.foreground.kind === 'active') {
      this.flashHint('运行中不能重试，先按 Esc 中断');
      return;
    }
    const sessionId = this.sessionId;
    hostData(
      await this.link.request({
        type: 'session/prompt',
        sessionId,
        input: {
          text: '',
          retryUserMessageId,
          ...this.composer.promptFields(),
        },
        foreground: { kind: 'if-idle' },
      }),
    );
    // The retried answer replaces the old one; reload rather than patch rows.
    await this.openSession(sessionId);
  }

  // ------------------------------------------------------------------- input

  private handleGlobalInput(data: string): TuiInputListenerResult {
    if (this.modals.isOpen) return undefined;
    const running = this.foreground.kind === 'active';
    if (matchesKey(data, Key.ctrl('c'))) {
      if (this.editor.getText().length > 0) {
        this.editor.setText('');
      } else if (running) {
        this.abortRun().catch((error: unknown) => this.reportError(error));
      } else if (Date.now() - this.lastInterruptAt < EXIT_CONFIRM_WINDOW_MS) {
        this.options.onExit();
      } else {
        this.lastInterruptAt = Date.now();
        this.flashHint('再按一次 Ctrl+C 退出');
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.escape) && running && !this.editor.isShowingAutocomplete()) {
      this.abortRun().catch((error: unknown) => this.reportError(error));
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
    this.statusHint = text;
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
      this.loader.setMessage(`${phase ?? '运行中'} · Esc 中断`);
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
    this.statusHint = undefined;
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
      this.statusHint,
      this.connected ? undefined : '重连中…',
      this.sessionName ?? (this.sessionId === undefined ? '新会话' : '未命名会话'),
      scope,
      ...this.composer.describe(),
      this.attachments.describe(),
      this.plans.describe(),
      usage,
      this.options.mock ? 'mock' : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · ');
  }
}
