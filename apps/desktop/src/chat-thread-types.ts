import type {
  ContextSummaryPush,
  ContextUsageSnapshot,
  FlashcardReviewCard,
  ModelProviderConfig,
  ModelRef,
  PermissionDecision,
  PermissionRememberScope,
  PlanExecutionMode,
  ProductSessionLineageView,
  SessionPlan,
  SessionSummary,
  TranscriptBranchPoint,
  SubagentInvocation,
  ThemeManifest,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import type {
  ChatMessageUi,
  PermissionPromptUi,
  RunRecordUi,
  SkillActivityView,
  CompactionActivityUi,
  SubagentStreamState,
} from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { DocumentOpenInput } from './tool-call-card';
import type { DocCardSequenceRequest } from './DocCardSequenceView';
import type { FilesChangedBarRequest } from './files-changed-bar';
import type { AgentLocatorAnimation, ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import type { ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import type { ModelOption } from './model-options';

export type ChatThreadProps = {
  messages: ChatMessageUi[];
  /** Active product session owning the rendered transcript. */
  sessionId?: string;
  /** History hydrate / resume — do not play entrance animation. */
  hydrating?: boolean;
  streaming: boolean;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  /** Active session id — CM-10 message context menu source session. */
  activeSessionId?: string | null;

  runRecordsById?: Record<string, RunRecordUi>;
  activeRunId?: string | null;
  /** Explicit slash Skill currently associated with the foreground prompt. */
  activeSkill?: SkillActivityView | null;
  /** Animation used by the compact live agent locator. */
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt?: PermissionPromptUi | null;
  /** Project path used to gate "always allow" (project remember) availability. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  /**
   * Host git request for turn-level files-changed stats (`git/diff-summary`).
   * Same adapter as ChangesPanel; optional so the bar still lists paths without stats.
   */
  filesChangedRequest?: FilesChangedBarRequest;
  onReviewChanges?: () => void;
  onPermission?: (decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void;
  workDetailsExpanded?: WorkDetailsExpanded;
  toolDensity?: ToolCallDensity;
  /** Whether intermediate Agent thinking should be rendered in the timeline. */
  showThinking?: boolean;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  /** Resend a user turn as a sibling branch (changed-text edit). */
  onBranchResend?: (messageId: string, text: string) => void;
  /** Re-run the same user turn without creating a prompt sibling. */
  onRetryTurn?: (userMessageId: string, options: { keepPrevious: boolean }) => void;
  branchPoints?: TranscriptBranchPoint[];
  onSwitchBranch?: (headMessageId: string) => void;
  /** Edit a still-pending instruction without rewinding conversation history. */
  onInterventionEdit?: (messageId: string, text: string) => void | Promise<void>;
  /** Cancel a still-pending instruction without cancelling its target Run. */
  onInterventionCancel?: (messageId: string) => void | Promise<void>;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  /** Load / rate / open-source for Doc Cards sequence messages. */
  docCardRequest?: DocCardSequenceRequest;
  /** Child projections bound to delegation tool calls in the transcript. */
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  /** Live child tails used for each inline block's latest activity. */
  subagentStreams?: Record<string, SubagentStreamState>;
  /** Whitelisted artifact actions, e.g. flashcard rating (ADR 0018 S5c). */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /** Open a fence explicitly declared with surface="canvas". */
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /**
   * Artifact capability from `config.artifact.enabled`. Required boolean —
   * never a truthy spread that drops `false`.
   */
  artifactPreviewEnabled: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to analyzeArtifactFence. */
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  /** Global composer configuration so the in-place edit card matches the bottom dock. */
  composerCard: ComposerDockProps;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Open an edited file's diff in the right inspector. */
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Transcript-bound compaction lifecycle activity. */
  compactionActivity?: CompactionActivityUi | null | undefined;
  onCompactAbort?: (() => void | Promise<void>) | undefined;
  /** Locale used by all run activity components. */
  locale?: 'zh-CN' | 'en';
  /** Walkthrough artifacts keyed by owning assistant messageId (spec §5.1). */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled (config walkthrough.enabled). */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (config walkthrough.autoGenerate). */
  walkthroughAutoGenerate?: boolean;
  /** Generate a walkthrough for a message; force overwrites an existing artifact. */
  onGenerateWalkthrough?:
    ((messageId: string, force?: boolean) => void | Promise<void>) | undefined;
  /** Cancel an in-flight walkthrough generation. */
  onCancelWalkthrough?:
    ((messageId: string, generationId?: string) => void | Promise<void>) | undefined;
  /** SF-03: Duplicate the entire session. */
  /** SF-03: Fork from a specific assistant response. */
  onForkFromMessage?: ((messageId: string) => void | Promise<void>) | undefined;
  /** SF-03: Open the lineage / branch list for a message. */
  onOpenForks?: ((messageId: string) => void) | undefined;
  /** SF-03: Map of messageId → direct fork count (for badge display). */
  forkCountsByMessageId?: Record<string, number>;
  /** SF-04: Product lineage projection for the active session. */
  sessionLineage?: ProductSessionLineageView | null;
  /** SF-04: Navigate to another product session from the lineage tree. */
  onOpenSession?: ((sessionId: string) => void) | undefined;
  /** SF-03: Whether derived-session actions are disabled (e.g. no host). */
  derivedActionsDisabled?: boolean;
  /** M1 assembly summaries keyed by runId. Never claims model-visible. */
  assemblySummariesByRunId?: Record<string, ContextSummaryPush>;
  /**
   * CHT-401: general-scope main session. Default false so Project callers and
   * existing tests keep the Agent presentation.
   */
  isConversationSession?: boolean;
  onResolveFlashcards?: (
    itemIds: string[],
  ) => Promise<FlashcardReviewCard[]>;
  /** Frozen send-time model for the in-flight turn's pending assistant row. */
  livePromptModel?: ModelRef | null;
  /** Active model options for name resolution. */
  modelOptions?: readonly ModelOption[];
  /** Configured providers for display names. */
  configProviders?: readonly ModelProviderConfig[];
  /** Session last turn context usage snapshot for turn usage chip. */
  contextUsage?: ContextUsageSnapshot | null;
  /** Draft/approved plan waiting on the creating turn's call chain. */
  sessionPlan?: SessionPlan | null;
  onPlanExecute?: (mode: PlanExecutionMode) => void | Promise<void>;
};
