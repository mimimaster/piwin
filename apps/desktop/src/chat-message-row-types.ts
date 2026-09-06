/** Shared contract for message rendering and memo invalidation. */

import type {
  PermissionDecision,
  PermissionRememberScope,
  ContextSummaryPush,
  ContextUsageSnapshot,
  ModelProviderConfig,
  ModelRef,
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
  SubagentStreamState,
  ToolCardUi,
} from './chat-reducer';
import type { SubagentInspectorSelection } from './subagent-activity-model';
import type { ExploreFlowRole } from './explore-flow';
import type { DocumentOpenInput } from './tool-call-card';
import type { FilesChangedBarRequest } from './chat-turn-files-summary';
import type { AgentLocatorAnimation, ToolCallDensity, WorkDetailsExpanded } from './ui-preferences';
import type { ComposerDockProps } from './composer-dock';
import type { DiffCardRequest } from './diff-card';
import type { ModelOption } from './model-options';
import type { DocCardSequenceRequest } from './DocCardSequenceView';

export type ChatMessageRowProps = {
  message: ChatMessageUi;
  sessionId?: string;
  messageIndex: number;
  showStreamingCaret: boolean;
  /** Quiet workbench: entrance animation for messages that arrived after mount. */
  isNew: boolean;
  /** Tool-reported changed paths from the containing turn for system summaries. */
  knownFilePaths?: readonly string[] | undefined;
  streaming: boolean;
  /** CM-10: source session for the message context menu ref. */
  activeSessionId: string | null;
  editingMessageId: string | null;
  lastUserMessageId: string | null;
  activeTheme: ThemeManifest | null;
  artifactThemeKey: string | number;
  runRecordsById: Record<string, RunRecordUi>;
  /** Keyed Run projection for this row; avoids whole-map memo invalidation. */
  runRecord?: RunRecordUi;
  activeRunId: string | null;
  activeSkill: SkillActivityView | null;
  agentLocatorAnimation?: AgentLocatorAnimation;
  permissionPrompt: PermissionPromptUi | null;
  workDetailsExpanded: WorkDetailsExpanded;
  toolDensity: ToolCallDensity;
  showThinking: boolean;
  /** Cross-message explore-flow role (anchor capsule / suppressed member). */
  exploreRole?: ExploreFlowRole;
  /** Project root forwarded to tool cards → DiffCard. */
  projectPath?: string | null;
  /** Host git request adapter forwarded to tool cards → DiffCard. */
  toolDiffRequest?: DiffCardRequest;
  filesChangedRequest?: FilesChangedBarRequest;
  onReviewChanges?: () => void;
  onEdit: (messageId: string) => void;
  onCancelEdit: () => void;
  onEditResend: (messageId: string, text: string) => void;
  onRetry: (messageId: string) => void;
  onRetryTurn?: (userMessageId: string, options: { keepPrevious: boolean }) => void;
  onBranchResend?: (messageId: string, text: string) => void;
  branchPoints?: TranscriptBranchPoint[];
  onSwitchBranch?: (headMessageId: string) => void;
  onInterventionEdit?: (messageId: string, text: string) => void | Promise<void>;
  onInterventionCancel?: (messageId: string) => void | Promise<void>;
  onFeedback?: ((message: string, level: 'info' | 'success' | 'error') => void) | undefined;
  /** Open the read-only subagent session inspector for a transcript card. */
  onInspectSubagent: ((selection: SubagentInspectorSelection) => void) | undefined;
  docCardRequest?: DocCardSequenceRequest;
  subagentChildren?: Record<string, SessionSummary>;
  subagentInvocations?: Record<string, SubagentInvocation>;
  subagentStreams?: Record<string, SubagentStreamState>;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /** Artifact capability. Always forwarded as a boolean. */
  artifactPreviewEnabled: boolean;
  /** When true, MarkdownView displays source code first for artifact blocks. */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to analyzeArtifactFence. */
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  /** Callback when clicking a search result file or file link. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Open an edited file's diff in the right inspector. */
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Callback when clicking a markdown document link or plan document chip. */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Locale used by all run activity components. */
  onPermission?:
    ((decision: PermissionDecision, rememberScope?: PermissionRememberScope) => void) | undefined;
  locale?: 'zh-CN' | 'en';
  /** Global composer card props so the edit mode matches the bottom composer. */
  composerCard: ComposerDockProps;
  /** Walkthrough artifacts keyed by owning assistant messageId. */
  walkthroughsByMessageId?: Record<string, WalkthroughArtifact>;
  /** Whether the Generate Walkthrough action is enabled. */
  walkthroughEnabled?: boolean;
  /** Whether auto-generation is active (hides the manual Generate button). */
  walkthroughAutoGenerate?: boolean;
  /** Pre-computed eligibility for the Generate button (computed by parent). */
  walkthroughEligible?: boolean;
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
  /** SF-03: Whether derived-session actions are disabled. */
  derivedActionsDisabled?: boolean;
  /** SF-03: True only for the last assistant message in a turn group. */
  isLastAssistantInTurn?: boolean;
  /** SF-04: True only for the newest completed assistant response. */
  isLatestAssistantResponse?: boolean;
  /** Assembly capsule for this user row, if Host recorded one. */
  assemblySummary?: ContextSummaryPush;
  isConversationSession?: boolean;
  onResolveFlashcards?: (
    itemIds: string[],
  ) => Promise<import('@piwin/contracts').FlashcardReviewCard[]>;
  /** Flashcard create tools from the whole turn; shown on the last assistant row. */
  turnFlashcardTools?: readonly ToolCardUi[];
  livePromptModel?: ModelRef | null;
  modelOptions?: readonly ModelOption[];
  configProviders?: readonly ModelProviderConfig[];
  contextUsage?: ContextUsageSnapshot | null;
  onRegenerate?: (() => void) | undefined;
  /** Conversation only: identity header on the first visible assistant in the turn. */
  showConversationHeader?: boolean;
  /** Conversation only: turn usage chip on that identity header. */
  showConversationTurnUsage?: boolean;
  /** Call-chain execution picker for a draft/approved plan created on this turn. */
  planExecutionGate?: {
    plan: SessionPlan;
    onExecute: (mode: PlanExecutionMode) => void | Promise<void>;
  };
};
