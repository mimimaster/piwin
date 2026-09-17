/** Session / run / subagent / side-chat HostCommand variants. */

import type { CreateSessionInput, PromptInput, SessionScope } from './host.js';
import type { SessionListOrder, SessionListPageQuery } from './session-list-page.js';
import type {
  SessionMessageProjection,
  SessionTranscriptPageQuery,
  SessionTranscriptWindowQuery,
} from './session-transcript-page.js';
import type { SessionUserMessageIndexQuery } from './session-user-message-index.js';
import type { SubagentBatchRequest } from './subagent-orchestration.js';
import type { SessionSearchQuery, SessionExportFormat } from './session-ops.js';
import type { UserInstructionPayload } from './run-intervention.js';
import type { PromptForegroundAdmission } from './prompt-admission.js';
import type { SessionListScopeRef } from './session-list-scope.js';

export type SessionHostCommand =
  | {
      id?: string;
      type: 'session/list';
      /** @deprecated Use `scope` field instead. */
      projectPath?: string;
      /**
       * Path-owning scope for local/CLI session listing.
       * Remote clients must not send Host absolute paths; use `scopeRef` instead.
       */
      scope?: import('./host.js').SessionScope;
      /**
       * Path-free logical scope for remote / multi-client shells.
       * Carries opaque projectId only — never Host filesystem paths.
       */
      scopeRef?: SessionListScopeRef;
      /** When true, lists sessions across all scopes (general and all projects). */
      allScopes?: boolean;
      /** When true, include archived sessions (default: active only). */
      includeArchived?: boolean;
      /**
       * Host-side global ordering of the filtered projection.
       * Truncation is applied after ordering. Omitted keeps the existing Host default.
       */
      order?: SessionListOrder;
      /**
       * Transport bound on the returned `sessions` array.
       * Omitted preserves the existing unbounded complete list.
       */
      maxItems?: number;
    }
  | {
      id?: string;
      type: 'session/list-page';
      query: SessionListPageQuery;
    }
  | { id?: string; type: 'session/create'; input: CreateSessionInput }
  | {
      id?: string;
      type: 'session/message-child';
      parentSessionId: string;
      childSessionId: string;
      text: string;
    }
  | { id?: string; type: 'session/list-children'; parentSessionId: string }
  | {
      id?: string;
      type: 'subagent/batch-start';
      request: SubagentBatchRequest;
      parentRunId?: string;
    }
  | { id?: string; type: 'subagent/batch-status'; runId: string }
  | { id?: string; type: 'subagent/batch-cancel'; runId: string }
  | { id?: string; type: 'subagent/continue'; childSessionId: string; text: string }
  | {
      id?: string;
      type: 'subagent/results';
      parentSessionId: string;
      attemptId?: string;
      pendingOnly?: boolean;
      cursor?: string;
      limit?: number;
    }
  | { id?: string; type: 'subagent/result'; resultId: string }
  | {
      id?: string;
      type: 'subagent/result-files';
      resultId: string;
      revision: number;
      cursor?: string;
      limit?: number;
    }
  | {
      id?: string;
      type: 'subagent/result-diff';
      resultId: string;
      revision: number;
      fileId: string;
    }
  | {
      id?: string;
      type: 'subagent/cleanup-plan';
      resultId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'subagent/request-resolution';
      resultId: string;
      expectedRevision: number;
      purpose: 'resolve' | 'verify';
    }
  | {
      id?: string;
      type: 'subagent/worktree-action';
      action: 'apply' | 'retain' | 'discard';
      childSessionId?: string;
      resultId?: string;
      expectedRevision?: number;
      cleanupToken?: string;
    }
  | { id?: string; type: 'subagent/worktree-gc-preview' }
  | { id?: string; type: 'subagent/worktree-gc' }
  | { id?: string; type: 'session/resume'; sessionId: string }
  | {
      id?: string;
      /** ADR 0040 §9: bounded outline page for older outline data. */
      type: 'session/outline-page';
      query: import('./session-transcript.js').SessionOutlinePageQuery;
    }
  | { id?: string; type: 'session/user-message-index'; query: SessionUserMessageIndexQuery }
  | { id?: string; type: 'session/transcript-page'; query: SessionTranscriptPageQuery }
  | { id?: string; type: 'session/transcript-window'; query: SessionTranscriptWindowQuery }
  | { id?: string; type: 'session/runtime-status'; sessionId: string }
  | {
      id?: string;
      type: 'session/reload-runtime';
      sessionId: string;
      expectedSettingsRevision: string;
      when: 'now' | 'after-current-run';
    }
  | { id?: string; type: 'session/messages'; sessionId: string }
  | {
      id?: string;
      type: 'session/foreground-run';
      sessionId: string;
    }
  | { id?: string; type: 'session/model-context-summary'; sessionId: string }
  | { id?: string; type: 'session/context-get'; sessionId: string }
  | {
      id?: string;
      type: 'session/prompt';
      sessionId: string;
      input: PromptInput;
      /** Internal Host admission path; remote clients must omit this. */
      admission?: 'queued-turn';
      /**
       * How to admit this prompt when a foreground run may already be active.
       * Required on remote Hosts; local JSONL may omit it (queued-turn covers
       * single-shell interruption).
       */
      foreground?: PromptForegroundAdmission;
      /**
       * Confirm discarding a previous attempt that wrote files (ADR 0064).
       * Only meaningful with `retryUserMessageId` and `keepPreviousAttempt`
       * omitted/false. Host refuses with `retry-discards-writes` until set.
       */
      confirm?: boolean;
    }
  | {
      id?: string;
      type: 'session/queued-turn-submit';
      sessionId: string;
      queuedTurnId: string;
      userMessageId: string;
      input: PromptInput;
    }
  | { id?: string; type: 'session/queued-turn-list'; sessionId: string }
  | {
      id?: string;
      type: 'session/queued-turn-edit';
      sessionId: string;
      queuedTurnId: string;
      expectedRevision: number;
      input: PromptInput;
    }
  | {
      id?: string;
      type: 'session/queued-turn-cancel';
      sessionId: string;
      queuedTurnId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'session/queued-turn-reorder';
      sessionId: string;
      expectedQueueRevision: number;
      orderedQueuedTurnIds: string[];
    }
  | {
      id?: string;
      type: 'session/replace-run';
      sessionId: string;
      runId: string;
      queuedTurnId: string;
      userMessageId: string;
      input: PromptInput;
    }
  | { id?: string; type: 'session/pause'; sessionId: string; runId?: string }
  | {
      id?: string;
      type: 'session/resume-run';
      sessionId: string;
      checkpointId?: string;
      /** Extra user instruction for the continuation. Omit for the default resume prompt. */
      text?: string;
    }
  | { id?: string; type: 'session/abort'; sessionId: string; runId?: string }
  | {
      id?: string;
      type: 'session/steer';
      sessionId: string;
      message: string;
      runId?: string;
      /** Matches an optimistic client row to the persisted Host transcript row. */
      clientMessageId?: string;
      /** Voice handover: persist the brief, wrap only the agent-facing steer. */
      source?: 'voice-delegation';
      voiceCallId?: string;
    }
  | {
      id?: string;
      type: 'run/intervention-submit';
      sessionId: string;
      runId: string;
      interventionId: string;
      userMessageId: string;
      input: UserInstructionPayload;
      /**
       * Explicit user-initiated conversion: adopt a pending queued turn's
       * durable identity instead of creating a new user row. The Host cancels
       * the queued turn and creates the intervention in one store transaction
       * (ADR 0051 §1 — never silent, always a deliberate shell action).
       */
      adoptQueuedTurn?: {
        queuedTurnId: string;
        expectedRevision: number;
      };
    }
  | {
      id?: string;
      type: 'run/intervention-edit';
      sessionId: string;
      runId: string;
      interventionId: string;
      expectedRevision: number;
      input: UserInstructionPayload;
    }
  | {
      id?: string;
      type: 'run/intervention-cancel';
      sessionId: string;
      runId: string;
      interventionId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'session/follow_up';
      sessionId: string;
      message: string;
      runId?: string;
      /** Matches the optimistic client row to the persisted Follow-up row. */
      clientMessageId?: string;
    }
  | {
      id?: string;
      type: 'session/compact';
      sessionId: string;
      customInstructions?: string;
      /**
       * When present, compact only if needed and validate the result against
       * this configured model's Host-resolved input budget. This command does
       * not change the session's selected model.
       */
      targetModel?: import('./host.js').ModelRef;
    }
  | {
      id?: string;
      /** Compact an ephemeral session snapshot and export only its summary. */
      type: 'session/compact-export';
      sessionId: string;
      customInstructions?: string;
      /** Absolute path; when omitted host writes under the session exports dir. */
      outputPath?: string;
    }
  | { id?: string; type: 'session/compact-abort'; sessionId: string }
  | { id?: string; type: 'session/compaction-settings'; sessionId: string }
  | {
      id?: string;
      type: 'session/set-auto-compaction';
      sessionId: string;
      enabled: boolean;
    }
  | {
      id?: string;
      /**
       * Sets desired session composer profile (session index).
       * Does not apply runtime / sessionModels / compact.
       * Does not belong on Live owner events.
       */
      type: 'session/set-composer-profile';
      sessionId: string;
      model?: import('./host.js').ModelRef;
      thinkingLevel?: import('./host.js').ThinkingLevel;
    }
  | {
      id?: string;
      type: 'side-chat/open';
      sourceSessionId: string;
      sourceMessageId?: string;
      name?: string;
      refs?: import('./side-chat.js').SideChatContextRef[];
    }
  | {
      id?: string;
      type: 'side-chat/list';
      sourceSessionId: string;
      includeArchived?: boolean;
    }
  | {
      id?: string;
      type: 'side-chat/sync';
      sideChatSessionId: string;
      refs?: import('./side-chat.js').SideChatContextRef[];
    }
  /** CE-CHAT: pin / search / product truncate-resend. */
  | { id?: string; type: 'session/pin'; sessionId: string }
  | { id?: string; type: 'session/unpin'; sessionId: string }
  /** PD-SESS: rename / archive-first lifecycle / permanent delete. */
  | { id?: string; type: 'session/rename'; sessionId: string; name: string }
  | {
      id?: string;
      type: 'session/auto-name';
      sessionId: string;
      /** First user message text for title generation. */
      firstMessage: string;
      /** Optional assistant reply text for richer context. */
      assistantReply?: string;
    }
  | { id?: string; type: 'session/archive'; sessionId: string }
  | { id?: string; type: 'session/unarchive'; sessionId: string }
  | { id?: string; type: 'session/lifecycle-plan' }
  | { id?: string; type: 'session/lifecycle-apply'; planId: string }
  | {
      id?: string;
      type: 'session/delete';
      sessionId: string;
      /**
       * Permanent delete normally requires the session to be archived first.
       * When true, allow delete of an active (non-archived) session after UI confirm.
       */
      force?: boolean;
    }
  /** PD-SESS-05: fork-light — copy product transcript into a new session id. */
  | {
      id?: string;
      type: 'session/duplicate';
      sessionId: string;
      /** Optional override; default "Copy of <name>". */
      name?: string;
      /**
       * Explicit destination for a safe "continue in project" copy. The
       * source session remains unchanged and auditable.
       */
      targetScope?: SessionScope;
      /** Defaults to `full` for older shells. New shells should request `none`. */
      messageProjection?: SessionMessageProjection;
    }
  /** SF-02: fork from a completed assistant response into a linked product session. */
  | {
      id?: string;
      type: 'session/fork';
      sessionId: string;
      /** Assistant response to fork from. Omit to use the latest completed assistant on the active path. */
      messageId?: string;
      /** Optional display name; default "(n) <source name>". */
      name?: string;
      /** V1 shared workspace; worktree is a follow-up slice. */
      workspaceStrategy: 'shared' | 'worktree';
      /** Defaults to `full` for older shells. New shells should request `none`. */
      messageProjection?: SessionMessageProjection;
    }
  /** SF-04: query the product lineage (branch family) for a session. */
  | {
      id?: string;
      type: 'session/lineage';
      sessionId: string;
    }
  | { id?: string; type: 'session/search'; query: SessionSearchQuery }
  /** ADR 0055: ‹n/m› switcher data for every fork along the active path. */
  | { id?: string; type: 'session/branch-list'; sessionId: string }
  /** ADR 0055: move the active leaf into the target message's branch. */
  | {
      id?: string;
      type: 'session/branch-switch';
      sessionId: string;
      targetMessageId: string;
      /** Acknowledge a `needs-confirmation` write-boundary response. */
      confirm?: boolean;
      /** Defaults to `tail`. */
      messageProjection?: SessionMessageProjection;
    }
  /**
   * Delete the message and its entire subtree (ADR 0055 explicit gesture —
   * the daily edit/regenerate path branches via prompt instead).
   */
  | {
      id?: string;
      type: 'session/truncate-from';
      sessionId: string;
      messageId: string;
      /** Defaults to `full`; Desktop requests a bounded `tail`. */
      messageProjection?: SessionMessageProjection;
    }
  /** CE-SHARE-01: local transcript export (MD/HTML). */
  | {
      id?: string;
      type: 'session/export';
      sessionId: string;
      format?: SessionExportFormat;
      redactTools?: boolean;
      /** Absolute path; when omitted host writes under session exports dir. */
      outputPath?: string;
      /**
       * Defaults to `file`. `content` returns the rendered document without
       * writing a host-side file (clipboard copy).
       */
      destination?: import('./session-ops.js').SessionExportDestination;
    }
  /** Cold Storage R1: non-destructive one-session pack backup. */
  | {
      id?: string;
      type: 'session/pack-create';
      sessionId: string;
      /**
       * Host-absolute publish directory for the pack + sidecar.
       * Must not live under the piwin root.
       */
      outputDir: string;
      /** Optional Host-safe pack id; Host generates one when omitted. */
      packId?: string;
    }
  | {
      id?: string;
      type: 'session/pack-verify';
      /** Host-absolute path to a `.piwin-pack` archive. */
      packPath: string;
    }
  | {
      id?: string;
      type: 'session/pack-list';
      /** Host-absolute directory that may contain `.piwin-pack` files. */
      directory: string;
    }
  /** Cold Storage R1: manual plan / execute / restore / reconcile. */
  | { id?: string; type: 'session/cold-storage-status' }
  | {
      id?: string;
      type: 'session/cold-storage-plan';
      /** When set, plan only these sessions (still must be eligible). */
      sessionIds?: string[];
    }
  | {
      id?: string;
      type: 'session/cold-storage-execute';
      planId: string;
      confirmationDigest: string;
    }
  | {
      id?: string;
      type: 'session/cold-storage-restore';
      sessionId: string;
      /** Host-absolute pack path. Defaults to the stub's last known packPath. */
      packPath?: string;
    }
  | {
      id?: string;
      type: 'session/cold-storage-import';
      /** Host-absolute pack path. Recreates a missing index stub from the manifest. */
      packPath: string;
    }
  | { id?: string; type: 'session/cold-storage-reconcile' }
  /**
   * Bounded on-demand read of a persisted tool output snapshot (Doc Preview
   * recovery for historical reads). Host re-checks redaction and byte caps.
   */
  | {
      id?: string;
      type: 'session/tool-output';
      sessionId: string;
      messageId: string;
      toolCallId: string;
      maxBytes?: number;
    };
