import type { ClipboardEvent, DragEvent } from 'react';
import type { ContextUsageSnapshot, HostStatusData, ProjectRecord } from '@piwin/contracts';
import type { LiveCallView, LiveReadyMissing } from '@piwin/contracts';
import type {
  ComposerMcpOption,
  ComposerPlusSubmenu,
  ComposerSkillOption,
} from './composer-plus-menu';
import type { PendingContextRefItem } from './hooks/use-composer-context-refs';
import type { AgentModeId } from './agent-mode';
import type { PendingComposerAttachment } from './media-utils';
import type { OrchestrationSchemeOption } from './OrchestrationSchemeControl';
import type { ExtensionUiResolvePayload } from './extension-ui-prompt';
import type { ExtensionUiRequestState } from './hooks/use-host-bootstrap';
import type { BranchChipRequest } from './branch-chip';
import type { AtWorkspaceEntry } from './at/at-file-index';
import type { SteerQueueMessage } from './steer-queue';

export type ComposerModelOption = {
  providerId: string;
  protocol?: import('@piwin/contracts').ModelProtocol;
  modelId: string;
  label: string;
  source?: import('@piwin/contracts').ModelSource;
  group?: import('@piwin/contracts').ConfiguredChatModelGroup;
  contextWindow?: number;
  /** Configured thinking level default for this model. */
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  /** Configured thinking effort levels supported by this model. */
  thinkingLevels?: readonly import('@piwin/contracts').ThinkingLevel[];
  /** True when model.reasoning is enabled. */
  reasoning?: boolean;
  /** True when model.input includes image. */
  supportsImage?: boolean;
  /** True when model.capabilities includes image-generation. */
  supportsImageGeneration?: boolean;
};

export type ComposerDockProps = {
  /** When true, path shows above the card and outer layout can center the dock. */
  layoutMode: 'centered' | 'docked';
  projectPath: string | null;
  projectTrusted: boolean;
  activeSessionId: string | null;
  streaming: boolean;
  runPhase: 'idle' | 'streaming' | 'pausing' | 'aborting';
  compacting: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  agentMode: AgentModeId;
  onAgentModeChange: (mode: AgentModeId) => void;
  /** Whether the bundled goal extension is enabled; gates `/goal` in the slash menu. */
  goalExtensionEnabled?: boolean;
  pendingAttachments: PendingComposerAttachment[];
  onRemoveAttachment: (localId: string) => void;
  /**
   * In-place edit: original media/refs sit read-only above the card, so Send
   * must stay enabled even when the local composer and chips are empty.
   */
  hasCarryContent?: boolean;
  /** One-tap retry after a failed media/save. */
  onRetryAttachment?: (localId: string) => void;
  /** Phase 0 send confirmation: re-queue every failed chip before sending. */
  onRetryFailedAttachments?: () => void;
  /** Phase 0 send confirmation: drop every failed chip and send the rest. */
  onDiscardFailedAttachments?: () => void;
  /** CM: structured context ref chips (file/selection/folder/…). */
  pendingContextRefs?: PendingContextRefItem[];
  onRemoveContextRef?: (key: string) => void;
  /** CM-17: `@` mention file/folder items also become structured refs. */
  onAddContextRef?: ((ref: import('@piwin/contracts').PromptContextRef) => void) | undefined;
  /** Bounded workspace file/folder index backing `@` mention completion. */
  atWorkspaceFiles?: readonly AtWorkspaceEntry[];
  docCommentsAttachment?: { docTitle: string; commentCount: number } | null | undefined;
  onRemoveDocComments?: (() => void) | undefined;
  dropActive: boolean;
  onDropActiveChange: (active: boolean) => void;
  plusMenuOpen: boolean;
  onPlusMenuOpenChange: (open: boolean) => void;
  plusSubmenu: ComposerPlusSubmenu;
  onPlusSubmenuChange: (submenu: ComposerPlusSubmenu) => void;
  modelOptions: ComposerModelOption[];
  selectedModelKey: string;
  selectedModelLabel?: string;
  onSelectModel: (key: string) => void;
  /**
   * When true, text-only models can still send images (host will describe them).
   * When false/undefined, attach a composer warning if the user adds media.
   */
  visionDelegationEnabled?: boolean;
  menuSkills: ComposerSkillOption[];
  menuMcp: ComposerMcpOption[];
  onRefreshComposerMenus: () => void;
  onOpenSkillsPanel: () => void;
  onOpenMcpPanel: () => void;
  onAttachFile: () => void;
  onAttachImage: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onSend: (text?: string) => void;
  /** Save the active turn as a resumable Host checkpoint. */
  onPause: () => void;
  /** Irreversible cancel. Esc / `stop-run` only — never a second composer circle. */
  onAbort: () => void;
  /** Host-owned admission. Run mutations stay off while unknown or reconciling. */
  mutationsEnabled?: boolean;
  /** Resume from a Host pause checkpoint. */
  onResume?: () => void;
  /** True when the Host run terminal is a resumable pause checkpoint. */
  paused?: boolean;
  /** Model-originated question rendered inline above the composer input. */
  extensionUiRequest?: ExtensionUiRequestState | null;
  extensionUiInput?: string;
  onExtensionUiInputChange?: (value: string) => void;
  onExtensionUiResolve?: (payload: ExtensionUiResolvePayload) => void;
  onExtensionUiAbort?: () => void | Promise<void>;
  onCompact: () => void;
  /** Host capability; when false compact slash is unavailable. Default true. */
  compactionSupported?: boolean;
  contextUsage: ContextUsageSnapshot | null;
  contextRingView?: import('./context-telemetry-selector.js').ContextRingViewModel;
  modelContextWindow?: number;
  onOpenModelSettings?: () => void;
  thinkingLevel?: import('@piwin/contracts').ThinkingLevel;
  onThinkingLevelChange?: (level: import('@piwin/contracts').ThinkingLevel) => void;
  ultraThinkingEnabled?: boolean;
  onSteer?: () => void;
  onFollowUp?: () => void;
  hostStatus?: HostStatusData | null;
  hostReady?: boolean;
  hostMock?: boolean;
  transportLabel?: string;
  onOpenHostSettings?: () => void;
  /** ADR 0024: Run Mode preset (Ask / Auto / YOLO). */
  runModePreset?: import('@piwin/contracts').PermissionPreset;
  onRunModeChange?: (preset: import('@piwin/contracts').PermissionPreset) => void;
  onRunModeSetDefault?: (preset: import('@piwin/contracts').PermissionPreset) => void;
  onOpenPermissionsSettings?: () => void;
  /** YOLO unavailable for untrusted projects. */
  runModeYoloDisabled?: boolean;
  /** ORCH: always-visible scheme mode picker; freehand (`off`) means no injection. */
  orchestrationSchemeId?: string;
  orchestrationSchemeOptions?: readonly OrchestrationSchemeOption[];
  onOrchestrationSchemeChange?: (schemeId: string) => void;
  /** ORCH: independent per-turn switch for model-facing delegation. */
  delegationDisabled?: boolean;
  onDelegationDisabledChange?: (disabled: boolean) => void;
  onOpenOrchestrationSchemeSettings?: () => void;
  /** Optional git request adapter for the footer branch chip. */
  branchRequest?:
    ((command: BranchChipRequest) => Promise<import('@piwin/contracts').HostResponse>) | undefined;
  /** Recently opened projects shown in the path dropdown above an empty composer. */
  recentProjects?: readonly ProjectRecord[];
  /** Switch directly to a project selected from the path dropdown. */
  onOpenProject?: ((path: string) => void) | undefined;
  /** True when Desktop is attached to a saved standalone Host. */
  runtimeRemoteConnected?: boolean;
  /** Hostname:port of the attached Host, when known. */
  runtimeRemoteHostLabel?: string;
  onSelectLocalRuntime?: () => void;
  onSelectAttachRuntime?: () => void;
  /** Open the flashcards home (legacy Knowledge Center slash aliases). */
  onOpenKnowledge?: ((subTab?: 'doccards' | 'cards' | 'wiki') => void) | undefined;
  /** Open the flashcards home from the plus menu. */
  onOpenCardsPanel?: (() => void) | undefined;
  /** True when the configured ASR provider/model is currently usable. */
  speechConfigured?: boolean;
  /** Transient Desktop → Host ASR request; audio is never saved by the composer. */
  speechRequest?: (
    input: import('@piwin/contracts').SpeechTranscribeInput,
  ) => Promise<import('@piwin/contracts').HostResponse>;
  live?: {
    enabled: boolean;
    canStart: boolean;
    starting: boolean;
    call: LiveCallView | null;
    error: string | null;
    missing: LiveReadyMissing[];
    onStart: () => void;
    onMute: (muted: boolean) => void;
    onEnd: () => void;
  };
  /** Steer messages queued for execution */
  steerQueueMessages?: readonly SteerQueueMessage[];
  onSteerQueueSendNow?: (messageId: string) => void | Promise<void>;
  /** Load a queued turn into this composer; editing happens in the input box. */
  onSteerQueueEdit?: (messageId: string) => void;
  onSteerQueueRemove?: (messageId: string) => void;
  /**
   * Queued turn currently held by the composer input. Send saves it back to
   * the queue instead of admitting a new turn; `position` is 1-based.
   */
  queuedEdit?: { messageId: string; position: number } | null;
  onQueuedEditCancel?: () => void;
  /**
   * Newest-first user prompts from the active session transcript.
   * Merged under the live stack when listing history (max 10).
   */
  sessionUserPrompts?: readonly string[];
  /** AJB: active jobs owned by the current session (isJobActive filter). */
  activeJobs?: readonly import('@piwin/contracts').JobRecord[];
  /** AJB: stop a controlled program (`job/stop`). */
  onStopJob?: (jobId: string) => void;
  /** AJB: open the right Terminal panel with the job's logs. */
  onViewJobLogs?: (jobId: string) => void;
  /**
   * CHT-501: general Conversation hides Run Mode / Orchestration /
   * Skills-MCP chrome. `/goal` stays available, as does its exit chip.
   */
  isConversationSession?: boolean;
  /** Override the Send control label (edit card: Retry vs Send new version). */
  sendAriaLabel?: string;
};
