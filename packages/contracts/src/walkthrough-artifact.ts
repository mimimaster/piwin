/**
 * Walkthrough Artifact contract (spec §7.1) and IPC response data shapes (§8.2).
 *
 * An Artifact is bound to a single final Assistant message (`sessionId + messageId`)
 * and persisted as Markdown. It is untrusted output: renderers must treat the
 * `markdown` field as untrusted Markdown and never execute embedded HTML/scripts.
 */

import type { ModelRef } from './host.js';
import type { WalkthroughMode } from './walkthrough.js';

export type WalkthroughGenerationStatus = 'generating' | 'ready' | 'error';

export type WalkthroughErrorCode =
  | 'disabled'
  | 'not-eligible'
  | 'session-not-found'
  | 'message-not-found'
  | 'model-unavailable'
  | 'provider-not-found'
  | 'model-not-configured'
  | 'missing-credentials'
  | 'unsupported-provider'
  | 'provider-request-failed'
  | 'provider-timeout'
  | 'empty-output'
  | 'invalid-config'
  | 'cancelled';

export type WalkthroughError = {
  code: WalkthroughErrorCode;
  /** Safe, user-facing message. Must not contain credentials or raw provider body. */
  message: string;
};

type WalkthroughArtifactBase = {
  version: 1;
  id: string;
  sessionId: string;
  messageId: string;
  runId?: string;
  planId?: string;
  mode: WalkthroughMode;
  model?: ModelRef;
  /** Hash of the bounded evidence source; never store raw prompt evidence here. */
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
};

export type WalkthroughArtifact =
  | (WalkthroughArtifactBase & {
      status: 'generating';
      generationId: string;
    })
  | (WalkthroughArtifactBase & {
      status: 'ready';
      markdown: string;
      truncated?: boolean;
      generatedAt: string;
      // `model` is required on `ready` artifacts (spec §7.1). The base declares
      // `model?: ModelRef`; intersecting with `model: ModelRef` narrows it to
      // required for this variant only.
      model: ModelRef;
    })
  | (WalkthroughArtifactBase & {
      status: 'error';
      error: WalkthroughError;
      generatedAt: string;
    });

/* ------------------------------------------------------------------ */
/* IPC response data shapes (spec §8.2).                              */
/* These are the `HostResponse.data` payloads for walkthrough commands. */
/* ------------------------------------------------------------------ */

/** `walkthrough/list` response data. */
export type WalkthroughListData = {
  sessionId: string;
  artifacts: WalkthroughArtifact[];
};

/** `walkthrough/generate` response data. */
export type WalkthroughGenerateData =
  | {
      sessionId: string;
      messageId: string;
      generationId: string;
      status: 'generating';
    }
  | {
      sessionId: string;
      messageId: string;
      generationId?: string;
      status: 'ready';
      artifact: WalkthroughArtifact;
    };

/** `walkthrough/cancel` response data. */
export type WalkthroughCancelData = {
  sessionId: string;
  messageId: string;
  generationId?: string;
  status: 'cancelled';
};
