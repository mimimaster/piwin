import type { Editor, TUI } from '@earendil-works/pi-tui';
import type { RemoteProjectSummary, SessionContextSnapshot } from '@piwin/contracts';
import {
  appendLocalUserMessage,
  appendNotice,
  removeLocalUserMessage,
  type TranscriptState,
} from './transcript-model.js';
import type { Keybindings } from './keybindings.js';
import type { ProjectFiles } from './project-files.js';
import { createTuiCommandTable } from './tui-command-table.js';
import { TuiArtifactController, type FileOpener } from './tui-artifact-controller.js';
import { TuiAttachmentController } from './tui-attachment-controller.js';
import { TuiComposerProfile } from './tui-composer-profile.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';
import { TuiFindController } from './tui-find-controller.js';
import { TuiPromptSender } from './tui-prompt-sender.js';
import { TuiRewindController } from './tui-rewind-controller.js';
import { TuiSessionExport } from './tui-session-export.js';
import { TuiSessionFeatures } from './tui-session-features.js';
import { TuiSessionSearch } from './tui-session-search.js';
import { TuiSessionSwitcher } from './tui-session-switcher.js';
import { TuiSideChatController } from './tui-side-chat-controller.js';
import { TuiTurnActions } from './tui-turn-actions.js';
import { TuiUsageController } from './tui-usage-controller.js';

/**
 * What the controllers need from the running app, and nothing else. Every
 * entry is a closure over `TuiApp` state, so the controllers stay free of the
 * app class and can be built (and tested) with a hand-made port.
 */
export type TuiWiringPort = {
  tui: TUI;
  editor: Editor;
  link: TuiHostLink;
  modals: TuiModalStack;
  files: ProjectFiles;
  embedded: boolean;
  keybindings: Keybindings;
  openFile?: FileOpener;
  getSessionId: () => string | undefined;
  getRunId: () => string | undefined;
  getTranscript: () => TranscriptState;
  /** Replaces the transcript; it does not redraw. */
  updateTranscript: (update: (transcript: TranscriptState) => TranscriptState) => void;
  getProjects: () => RemoteProjectSummary[];
  getContext: () => SessionContextSnapshot | undefined;
  /** Replaced whenever the user moves to another conversation. */
  getConversation: () => object;
  getEditingMessageId: () => string | undefined;
  setEditingMessageId: (messageId: string | undefined) => void;
  isRunning: () => boolean;
  ensureSession: () => Promise<string>;
  openSession: (sessionId: string) => Promise<void>;
  startDraftSession: () => void;
  /** A prompt was accepted: show activity before the run push arrives. */
  onTurnAccepted: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  renameCurrentSession: (name: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  /** A prompt was sent: keep it for Up-arrow and Ctrl+R. */
  rememberPrompt: (text: string) => void;
  refresh: () => void;
  hint: (text: string) => void;
  error: (error: unknown) => void;
  exit: () => void;
};

export type TuiControllers = {
  composer: TuiComposerProfile;
  attachments: TuiAttachmentController;
  features: TuiSessionFeatures;
  sideChat: TuiSideChatController;
  turns: TuiTurnActions;
  usage: TuiUsageController;
  rewind: TuiRewindController;
  sender: TuiPromptSender;
  sessionSwitcher: TuiSessionSwitcher;
  runCommand: (name: string, argument: string) => Promise<void>;
};

/** Builds the feature controllers and the slash-command table over one port. */
export function createTuiControllers(port: TuiWiringPort): TuiControllers {
  const notify = (tone: 'info' | 'error', text: string): void => {
    port.updateTranscript((transcript) => appendNotice(transcript, tone, text));
    port.refresh();
  };
  const echoUser = (messageId: string, text: string, annotations: string[]): void => {
    port.updateTranscript((transcript) => appendLocalUserMessage(transcript, messageId, text, annotations));
  };
  const setComposerText = (text: string): void => {
    port.editor.setText(text);
    port.tui.requestRender();
  };
  const openSessionQuietly = (sessionId: string): void => {
    port.openSession(sessionId).catch((error: unknown) => port.error(error));
  };

  const composer = new TuiComposerProfile({
    link: port.link,
    modals: port.modals,
    getSessionId: port.getSessionId,
    onChanged: port.refresh,
    onHint: port.hint,
    onError: port.error,
  });
  const attachments = new TuiAttachmentController({
    link: port.link,
    ensureSession: port.ensureSession,
    onChanged: port.refresh,
    onHint: port.hint,
    onNotice: notify,
  });
  const features = new TuiSessionFeatures({
    link: port.link,
    modals: port.modals,
    embedded: port.embedded,
    getSessionId: port.getSessionId,
    getRunId: port.getRunId,
    getTranscript: port.getTranscript,
    isRunning: port.isRunning,
    openSession: port.openSession,
    onChanged: port.refresh,
    onHint: port.hint,
    onNotice: notify,
    onError: port.error,
    echoUser,
    setComposerText,
  });
  const sideChat = new TuiSideChatController({
    link: port.link,
    modals: port.modals,
    getSessionId: port.getSessionId,
    getTranscript: port.getTranscript,
    isRunning: port.isRunning,
    openSession: port.openSession,
    onChanged: port.refresh,
    onHint: port.hint,
    onNotice: notify,
    onError: port.error,
  });
  const turns = new TuiTurnActions({
    request: (command) => port.link.request(command),
    embedded: port.embedded,
    sessionId: port.getSessionId,
    runId: port.getRunId,
    isRunning: port.isRunning,
    transcript: port.getTranscript,
    promptFields: () => composer.promptFields(),
    hint: port.hint,
    notice: notify,
    echoUser: (messageId, text, annotations) => {
      echoUser(messageId, text, annotations);
      port.refresh();
    },
    openSession: port.openSession,
    beginEdit: (messageId, text) => {
      port.setEditingMessageId(messageId);
      port.editor.setText(text);
      port.refresh();
    },
  });
  const sender = new TuiPromptSender({
    link: port.link,
    queue: features.queue,
    attachments,
    files: port.files,
    composer,
    sideChat,
    conversation: port.getConversation,
    ensureSession: port.ensureSession,
    isRunning: port.isRunning,
    runId: port.getRunId,
    editingMessageId: port.getEditingMessageId,
    clearEditing: () => port.setEditingMessageId(undefined),
    echoUser: (messageId, text, annotations) => {
      echoUser(messageId, text, annotations);
      port.refresh();
    },
    removeEcho: (messageId) => {
      port.updateTranscript((transcript) => removeLocalUserMessage(transcript, messageId));
      port.refresh();
    },
    returnToComposer: (text) => {
      const typed = port.editor.getText();
      setComposerText(typed.length === 0 ? text : `${text}\n${typed}`);
    },
    onTurnAccepted: port.onTurnAccepted,
    reloadSession: port.openSession,
    onChanged: port.refresh,
    onHint: port.hint,
    onNotice: notify,
  });
  const sessionSwitcher = new TuiSessionSwitcher({
    link: port.link,
    modals: port.modals,
    getProjects: port.getProjects,
    getCurrentSessionId: port.getSessionId,
    onOpen: openSessionQuietly,
    onNew: port.startDraftSession,
    onRename: port.renameSession,
    onError: port.error,
    onHint: port.hint,
    onNotice: notify,
    requestRender: () => port.tui.requestRender(),
  });
  const sessionExport = new TuiSessionExport({
    link: port.link,
    getSessionId: port.getSessionId,
    defaultDir: () => process.cwd(),
    onHint: port.hint,
    onNotice: notify,
  });
  const sessionSearch = new TuiSessionSearch({
    link: port.link,
    modals: port.modals,
    onOpen: openSessionQuietly,
    onError: port.error,
    requestRender: () => port.tui.requestRender(),
  });
  const usage = new TuiUsageController({
    modals: port.modals,
    getSessionId: port.getSessionId,
    getContext: port.getContext,
    describeModel: () => composer.describeModelAndThinking(),
  });
  const rewind = new TuiRewindController({
    modals: port.modals,
    getTranscript: port.getTranscript,
    beginEditingTurn: (messageId) => turns.beginEditingTurn(messageId),
    onHint: port.hint,
  });
  const find = new TuiFindController({ modals: port.modals, getTranscript: port.getTranscript });
  const runCommand = createTuiCommandTable({
    embedded: port.embedded,
    keybindings: port.keybindings,
    composer,
    attachments,
    plans: features.plans,
    queue: features.queue,
    branches: features.branches,
    subagents: features.subagents,
    turnChanges: features.turnChanges,
    walkthroughs: features.walkthroughs,
    sideChat,
    artifacts: new TuiArtifactController({
      modals: port.modals,
      getTranscript: port.getTranscript,
      onHint: port.hint,
      onNotice: notify,
      onError: port.error,
      ...(port.openFile === undefined ? {} : { openFile: port.openFile }),
    }),
    turns,
    usage,
    rewind,
    find,
    sessionSwitcher,
    sessionExport,
    sessionSearch,
    startDraftSession: port.startDraftSession,
    loadOlderMessages: port.loadOlderMessages,
    renameSession: port.renameCurrentSession,
    sendReplacingRun: (text) => {
      port.rememberPrompt(text);
      return sender.send(text, true);
    },
    setComposerText,
    hint: port.hint,
    notice: notify,
    exit: port.exit,
  });
  return { composer, attachments, features, sideChat, turns, usage, rewind, sender, sessionSwitcher, runCommand };
}
