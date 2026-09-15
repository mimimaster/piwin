import type { SessionTodoList } from './automation.js';
import type {
  BrowserControllerPush,
  BrowserStatePush,
  WebElementPickResult,
} from './browser.js';
import type { GenerationJob, IngestionJob } from './doc-rag-v2.js';
import type { ExtensionUiKind } from './extension-ui.js';
import type { ExtensionDeploymentRecord, ExtensionSummary } from './extensions.js';
import type {
  AgentEvent,
  AgentEventEnvelope,
  HostMode,
  PermissionDecision,
  SessionSummary,
} from './host.js';
import type { JobHostPush } from './job.js';
import type { ContextSummaryPush } from './model-context.js';
import type { PetRuntimeSnapshot } from './pet.js';
import type { SessionPlan } from './plan.js';
import type { PlanExecutionState } from './plan-execution.js';
import type { QueuedTurnRecord } from './queued-turn.js';
import type { RunHostPush } from './run.js';
import type { RunInterventionRecord } from './run-intervention.js';
import type { SessionRuntimeStatus } from './session-runtime.js';
import type {
  SubagentBatchProjection,
  SubagentInvocation,
  SubagentTaskResult,
} from './subagent-orchestration.js';
import type { SubagentResultSummary } from './subagent-result.js';
import type { SubscriptionAuthPush } from './subscription-oauth.js';
import type { TurnChangeSummary } from './turn-change.js';
import type { LiveOwnerActionPush, LiveUpdatedPush } from './voice-live.js';
import type { WalkthroughArtifact } from './walkthrough-artifact.js';

/**
 * ADR 0027: transport-level sequencing fields attached to every push when a
 * sequenced sink is attached. Optional on every variant; existing consumers
 * ignore them. Applied via intersection below so the discriminated union on
 * `type` stays intact.
 */
export type HostPushSequencing = {
  /** Monotonic per host process, not per session. Used for `host/replay`. */
  seq?: number;
  /** Stable id for idempotent delivery (distinct from AgentEventEnvelope.eventId). */
  eventId?: string;
};

export type HostPushVariant =
  | { type: 'event'; sessionId: string; event: AgentEvent; envelope?: AgentEventEnvelope }
  | {
      type: 'session/name-updated';
      sessionId: string;
      name: string;
      nameSource: 'text' | 'llm' | 'user';
    }
  | {
      type: 'session/index-updated';
      op: 'created' | 'pinned' | 'unpinned' | 'archived' | 'unarchived' | 'deleted' | 'updated';
      sessionId: string;
      session?: import('./host.js').SessionSummary;
    }
  | {
      type: 'settings/updated';
      revision: string;
      runtimeRevision: string;
      changedDomains: import('./settings.js').SettingsDomain[];
    }
  | { type: 'plan/updated'; sessionId: string; plan: SessionPlan | null }
  | { type: 'plan/execution-updated'; state: PlanExecutionState }
  | {
      type: 'subagent/updated';
      parentSessionId: string;
      child: SessionSummary;
    }
  | {
      type: 'subagent/invocation-updated';
      parentSessionId: string;
      invocation: SubagentInvocation;
    }
  | { type: 'subagent/merged'; parentSessionId: string; childSessionId: string; messageId: string }
  | {
      type: 'subagent/batch-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentBatchProjection;
    }
  | {
      type: 'subagent/task-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentTaskResult;
    }
  | {
      type: 'subagent/result-updated';
      parentSessionId: string;
      result: SubagentResultSummary;
    }
  | {
      type: 'turn-changes/updated';
      workspaceId: string;
      changeSetId: string;
      revision: number;
      summary: TurnChangeSummary;
    }
  | {
      type: 'turn-changes/operation-updated';
      workspaceId: string;
      operationId: string;
      changeSetId: string;
    }
  | { type: 'workspace-files-updated'; workspaceId: string }
  | {
      type: 'subagent/stream';
      parentSessionId: string;
      childSessionId: string;
      event: AgentEvent;
      envelope?: AgentEventEnvelope;
    }
  | { type: 'session/runtime-updated'; status: SessionRuntimeStatus }
  /** ADR 0055: the active leaf moved (branch prompt/switch/subtree delete). */
  | {
      type: 'session/branch-updated';
      sessionId: string;
      activeLeafMessageId: string | null;
      branchPointCount: number;
    }
  | {
      type: 'transcript/append';
      sessionId: string;
      message: import('./session-transcript.js').SessionTranscriptMessage;
    }
  | {
      type: 'reply-writer/updated';
      sessionId: string;
      messageId: string;
      status: 'started' | 'applied' | 'failed';
      model?: import('./host.js').ModelRef;
      language?: import('./reply-writer.js').ReplyWriterLanguage;
    }
  | {
      type: 'permission/request';
      sessionId: string;
      requestId: string;
      action: string;
      detail: string;
      defaultDecision: PermissionDecision;
      context?: import('./host.js').PermissionRequestContext;
      runId?: string;
    }
  | {
      type: 'permission/resolved';
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
      runId?: string;
    }
  | { type: 'host/status'; mode: HostMode; ready: boolean; mock: boolean }
  | { type: 'host/log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'pty/output'; ptyId: string; data: string; at: string }
  | { type: 'pty/exit'; ptyId: string; exitCode?: number | null }
  | { type: 'todo/updated'; sessionId: string; items: SessionTodoList['items'] }
  | { type: 'automation/cron_finished'; jobId: string; ok: boolean; message?: string }
  | {
      type: 'extension/ui_request';
      sessionId: string;
      requestId: string;
      kind: ExtensionUiKind;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
    }
  | { type: 'pet/state'; pet: PetRuntimeSnapshot }
  // width/height are CSS viewport px (screencast deviceWidth/Height or
  // Playwright viewportSize), not JPEG bitmap px. The panel maps clicks
  // against these values vs img.clientWidth — never img.naturalWidth.
  | { type: 'browser/frame'; dataUrl: string; width: number; height: number; ts: number; encodedWidth?: number; encodedHeight?: number; sourceDpr?: number; quality?: number; producer?: 'screencast' | 'screenshot-fallback'; byteLength?: number; frameId?: string }
  | BrowserStatePush
  | { type: 'browser/picked'; result: WebElementPickResult }
  | {
      type: 'browser/console';
      level: 'log' | 'warning' | 'error';
      text: string;
      url: string;
      ts: number;
    }
  | {
      type: 'browser/network';
      method: string;
      url: string;
      status: number;
      resourceType: string;
      duration: number;
      ts: number;
    }
  | BrowserControllerPush
  | {
      type: 'walkthrough/updated';
      sessionId: string;
      artifact: WalkthroughArtifact;
    }
  | { type: 'extension/catalog-updated'; registryRevision: string; extensions: ExtensionSummary[] }
  | { type: 'extension/deployment-updated'; deployment: ExtensionDeploymentRecord }
  | {
      /** ADR 0027: replay buffer drained for a sequenced sink. */
      type: 'host/replay-done';
      sinceSeq: number;
      /** Last seq emitted by this replay, or sinceSeq if nothing was buffered. */
      lastSeq?: number;
    }
  | ContextSummaryPush
  | JobHostPush
  | RunHostPush
  | { type: 'run/intervention-updated'; intervention: RunInterventionRecord }
  | { type: 'session/queued-turn-updated'; queuedTurn: QueuedTurnRecord }
  | { type: 'doccards/index-progress'; job: IngestionJob }
  | { type: 'doccards/index-terminal'; job: IngestionJob }
  | { type: 'doccards/generation-progress'; job: GenerationJob }
  | {
      type: 'doccards/generation-terminal';
      job: GenerationJob;
      sessionId?: string;
      cardIds?: string[];
    }
  | SubscriptionAuthPush
  | LiveUpdatedPush
  | LiveOwnerActionPush;

/** ADR 0027: HostPush is the variant union plus optional transport sequencing. */
export type HostPush = HostPushVariant & HostPushSequencing;
