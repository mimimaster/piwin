/**
 * In-session conversation tree contracts (ADR 0055).
 *
 * The tree authority is the per-session product transcript store
 * (`parent_message_id` + one active leaf). Clients never hold the tree:
 * `SessionTranscriptMessage` carries no parent field. The ‹n/m› switcher
 * renders from `session/branch-list` data and switches with
 * `session/branch-switch`; the daily edit/regenerate path branches via
 * `PromptInput.branchFromMessageId` instead of destructive truncation.
 */

import type { SessionSummary } from './host.js';
import type { SessionTranscriptMessage } from './session-transcript.js';
import type { SessionTranscriptPageInfo } from './session-transcript-page.js';
import type { WorkspaceWrites } from './workspace-writes.js';

export type TranscriptBranchSibling = {
  /** First message of the branch (the row whose parent is the anchor). */
  headMessageId: string;
  /** Bounded preview of the head message text. */
  preview: string;
  /** Bounded preview of the deepest message of the branch. */
  leafPreview: string;
  /** Rows in the branch subtree. */
  messageCount: number;
  /**
   * Any row in the branch subtree recorded workspace writes (ADR 0055 §6.1).
   * Drives the panel's write marker so a switch that will strand file changes
   * is visible before the confirmation card appears. Rows written before the
   * write boundary shipped carry no metadata and read as `false`; the switch
   * check stays authoritative.
   */
  writesWorkspace: boolean;
  /** Newest message timestamp in the branch subtree. */
  updatedAt: string;
};

export type TranscriptBranchPoint = {
  /** Shared parent of the sibling heads; null when the fork is at the root. */
  anchorMessageId: string | null;
  /** Index of the active branch within `siblings` (sequence order). */
  activeIndex: number;
  siblings: TranscriptBranchSibling[];
};

export type SessionBranchListData = {
  sessionId: string;
  /** Same token family as transcript pages; changes on every leaf move. */
  revision: string;
  branchPoints: TranscriptBranchPoint[];
};

export type SessionBranchSwitchData =
  | {
      status: 'switched';
      sessionId: string;
      activeLeafMessageId: string;
      session: SessionSummary;
      messages?: SessionTranscriptMessage[];
      transcriptPage?: SessionTranscriptPageInfo;
    }
  | {
      /**
       * Abandoned-branch writes that the destination path never saw.
       * Disk does not follow the switch; the client must confirm.
       */
      status: 'needs-confirmation';
      offPathWrites: WorkspaceWrites;
    }
  | {
      /** A foreground run is active; switching now would corrupt the run. */
      status: 'run-active';
    };
