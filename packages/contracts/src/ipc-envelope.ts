import type { HostProblem } from './host-problem.js';
import type { HostPush } from './ipc-push.js';
import type { HostHydrationFrame, HostSnapshotFrame } from './remote-protocol.js';

/** Host → UI / external client (responses + push) */
export type HostResponse =
  | { id?: string; type: 'response'; command: string; success: true; data?: unknown }
  | {
      id?: string;
      type: 'response';
      command: string;
      success: false;
      /** Human-readable failure text; always present for failed responses. */
      error: string;
      /** Optional structured problem; does not replace `error`. */
      problem?: HostProblem;
    };

/** One canonical sequenced push inside a cursor batch. */
export type HostSequencedPush = {
  seq: number;
  eventId: string;
  push: HostPush;
};

/** Additive bounded batch framing for local and remote Host transports. */
export type HostPushBatchFrame = {
  type: 'push/batch';
  hostInstanceId: string;
  /** Cursor the receiver must hold before applying this frame. */
  afterSeq: number;
  /** Highest canonical sequence examined for this client. */
  throughSeq: number;
  /** Ordered subset in (afterSeq, throughSeq]. */
  items: HostSequencedPush[];
};

export type HostServerMessage =
  | HostResponse
  | HostPush
  | HostPushBatchFrame
  | HostHydrationFrame
  | HostSnapshotFrame;
