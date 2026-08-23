import type { Dispatch } from 'react';
import type {
  ForegroundRunMismatchProblem,
  PermissionPreset,
  PromptContextRef,
  ThinkingLevel,
} from '@piwin/contracts';
import type { ChatUiAction, ChatUiState } from '../chat-reducer';
import type { AgentModeId } from '../agent-mode';
import type { BusyRunChoice } from '../prompt-foreground';
import type { HostClient } from '../host-client';

export type UseComposerMediaArgs = {
  hostClient: HostClient;
  state: ChatUiState;
  dispatch: Dispatch<ChatUiAction>;
  dispatchNotification?: Dispatch<import('../notification-queue').NotificationAction>;
  agentMode: AgentModeId;
  onAgentModeChange?: (mode: AgentModeId) => void;
  /** Composer Run Mode for this session; sent on each prompt so Host can gate tools. */
  permissionPreset?: PermissionPreset;
  /** Skills available for `/name` send intercept. */
  menuSkills?: Array<{ id: string; name: string; enabled: boolean }>;
  onCompact?: (customInstructions?: string) => Promise<void>;
  onAbort?: () => Promise<void>;
  /** Create (or ensure) a live session when the user sends without one. */
  ensureSession?: (options?: {
    projectPath?: string;
    alreadyTrusted?: boolean;
    scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  }) => Promise<string | null>;
  /** When Send has no workspace, open the workspace picker (keep draft text). */
  onNeedWorkspace?: () => void | Promise<void>;
  /** Per-next-turn model key `providerId::modelId`. */
  selectedModelKey?: string;
  modelOptions?: Array<{
    protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
    providerId: string;
    modelId: string;
    supportsImage?: boolean;
    thinkingLevels?: readonly ThinkingLevel[];
    reasoning?: boolean;
  }>;
  thinkingLevel?: ThinkingLevel;
  /** ORCH: omit the model-facing delegation tool for this turn. */
  delegationDisabled?: boolean;
  /** ORCH: per-send scheme id; omit/off means no scheme field. */
  orchestrationSchemeId?: string;
  /** ORCH: slash /scheme sets the composer scheme without sending. */
  onOrchestrationSchemeChange?: (schemeId: string) => void;
  /**
   * When true, text-only + media is allowed (host will describe or path-inject).
   * When false/undefined and selected model lacks vision, confirm before send.
   */
  visionDelegationEnabled?: boolean;
  /** Optional confirm dialog for text-only + media without delegation. */
  confirmTextOnlyImageSend?: (message: string) => Promise<boolean>;
  confirmForegroundReplace?: (problem: ForegroundRunMismatchProblem) => Promise<boolean>;
  confirmBusyRun?: (problem: ForegroundRunMismatchProblem) => Promise<BusyRunChoice>;
  /** CM: pending structured context refs for session/prompt. */
  getPendingContextRefs?: () => PromptContextRef[];
  /** CM: token-stable snapshot so a send never re-reads mutable chips. */
  getPendingContextRefTokens?: () => import('./use-composer-context-refs').ContextRefSnapshot;
  /** CM: clear chips after a successful optimistic send paint. */
  clearPendingContextRefs?: () => void;
  /** CM: consume only the ref instances this send actually captured. */
  consumePendingContextRefs?: (
    snapshot: import('./use-composer-context-refs').ContextRefSnapshot,
  ) => void;
  /** CM: restore chips for a session/draft snapshot (session isolation). */
  restorePendingContextRefs?: (refs: PromptContextRef[]) => void;
  /**
   * CM-08: convert a workspace file-tree path drop into a structured context
   * ref. Return false to fall back to inserting the path text into the composer.
   */
  addContextRefFromDrop?: (payload: { absolutePath: string; relativePath: string }) => boolean;
  /** Conversation chat ignores Agent slash modes, skills, and orchestration. */
  conversationChat?: boolean;
  /** Open Knowledge Center overlay on slash command submit (/knowledge, /notes). */
  onOpenKnowledge?: (subTab?: 'doccards' | 'cards' | 'wiki') => void;
  /** Open the right-panel Flashcards due queue (/flashcards). */
  onOpenCardsPanel?: () => void;
};
