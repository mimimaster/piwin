import type { AgentMessageRole, HostMode } from './host.js';
import type { HostCommand, HostPush, HostPushBatchFrame, HostResponse } from './ipc.js';
import type { SessionListPageResult } from './session-list-page.js';

/** The first version of the private shell-to-host wire protocol. */
export const HOST_PROTOCOL_VERSION = 1 as const;

export type HostProtocolVersion = typeof HOST_PROTOCOL_VERSION;

export type HostClientType = 'mobile' | 'desktop' | 'cli' | 'web';

/** Capabilities a client advertises before the server selects batch framing. */
export type HostClientCapabilities = {
  pushBatching?: boolean;
  cursorBatches?: boolean;
  boundedReplay?: boolean;
  hydration?: boolean;
};

export type HostClientHello = {
  type: 'client/hello';
  protocolVersion: HostProtocolVersion;
  clientType: HostClientType;
  clientVersion: string;
  clientId: string;
  lastSeq: number;
  /** Host identity associated with lastSeq; absent for legacy clients. */
  lastHostInstanceId?: string;
  capabilities?: HostClientCapabilities;
  /** Optional bounded session set the client wants included in hydration. */
  subscriptions?: HostClientSubscriptions;
  authToken?: string;
};

export type HostClientSubscriptions = {
  sessionIds?: string[];
};

export type RemoteCapabilitySummary = {
  pushSequencing: boolean;
  replay: boolean;
  snapshot: boolean;
  sessionRead: boolean;
  sessionControl: boolean;
  permissionResolve: boolean;
  mediaUpload: boolean;
  pushBatching?: boolean;
  cursorBatches?: boolean;
  boundedReplay?: boolean;
  hydration?: boolean;
};

export type HostHello = {
  type: 'host/hello';
  protocolVersion: HostProtocolVersion;
  hostInstanceId: string;
  currentSeq: number;
  authRequired: boolean;
  authenticated: boolean;
  capabilities: RemoteCapabilitySummary;
};

export type RemoteHostStatusData = {
  hostInstanceId: string;
  protocolVersion: HostProtocolVersion;
  mode: HostMode;
  ready: boolean;
  mock: boolean;
  activeSessionCount: number;
  capabilities: RemoteCapabilitySummary;
};

export type RemoteProjectSummary = {
  projectId: string;
  displayName: string;
  trust?: 'trusted' | 'untrusted' | 'unknown';
  lastOpenedAt?: string;
};

export type RemoteSessionScopeKind = 'general' | 'project' | 'unknown';

export type RemoteSessionSummary = {
  sessionId: string;
  name?: string;
  scope: RemoteSessionScopeKind;
  kind?: string;
  updatedAt?: string;
  messageCount?: number;
  lastPreview?: string;
  pinned?: boolean;
  archived?: boolean;
  parentSessionId?: string;
};

export type RemoteSessionListPageData = SessionListPageResult<RemoteSessionSummary>;

export type RemoteTranscriptMessage = {
  id: string;
  role: AgentMessageRole;
  text: string;
  createdAt: string;
  status: 'streaming' | 'done' | 'error';
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  outcome?: 'completed' | 'cancelled' | 'failed';
  terminalMessage?: string;
  thinking?: string;
  attachmentCount?: number;
};

/** Remote-safe media projection; Host filesystem paths never cross this boundary. */
export type RemoteMediaAsset = {
  id: string;
  mimeType: string;
  byteSize: number;
  width?: number;
  height?: number;
};

export type RemoteMediaSaveData = {
  asset: RemoteMediaAsset;
};

export type RemoteSessionMessagesData = {
  sessionId: string;
  messages: RemoteTranscriptMessage[];
};

export type RemoteSessionTranscriptPageInfo = {
  revision: string;
  totalCount: number;
  startIndex: number;
  endIndex: number;
  messageBytes: number;
  truncatedMessageIds?: string[];
  olderCursor?: string;
};

export type RemoteSessionTranscriptPageData =
  | {
      status: 'page';
      messages: RemoteTranscriptMessage[];
      page: RemoteSessionTranscriptPageInfo;
    }
  | {
      status: 'stale-cursor';
      currentRevision: string;
    };

export type RemoteSessionOutlineNode = {
  id: string;
  role: AgentMessageRole;
  preview: string;
  createdAt: string;
};

export type RemoteSessionResumeData = {
  sessionId: string;
  live: boolean;
  messages: RemoteTranscriptMessage[];
  transcriptPage?: RemoteSessionTranscriptPageInfo;
  scope: RemoteSessionScopeKind;
  name?: string;
  model?: {
    protocol: string;
    providerId: string;
    modelId: string;
  };
  thinkingLevel?: string;
  outline?: RemoteSessionOutlineNode[];
};

export type HostCommandFrame = {
  type: 'command';
  requestId: string;
  command: HostCommand;
  idempotencyKey?: string;
};

export type HostResponseFrame = {
  type: 'response';
  requestId: string;
  response: HostResponse;
};

export type HostPushFrame = {
  type: 'push';
  seq: number;
  eventId: string;
  push: HostPush;
};

export type HostReplayFrame = {
  type: 'replay';
  requestId: string;
  sinceSeq: number;
};

export type HostReplayDoneFrame = {
  type: 'replay/done';
  requestId: string;
  fromSeq: number;
  toSeq: number;
  currentSeq: number;
  complete: boolean;
};

export type HostSnapshotFrame = {
  type: 'snapshot';
  requestId?: string;
  reason: 'replay-too-old' | 'requested';
  currentSeq: number;
  status: RemoteHostStatusData;
};

/** Bounded, host-path-free state replacement used after replay continuity is lost. */
export type HostHydrationSnapshot = {
  snapshotId: string;
  hostInstanceId: string;
  snapshotSeq: number;
  status: RemoteHostStatusData;
  sessions: RemoteSessionSummary[];
  messagesBySession: Record<string, RemoteTranscriptMessage[]>;
  truncatedSessionIds: string[];
};

export type HostHydrationFrame = {
  type: 'hydration';
  reason: 'replay-too-old' | 'host-instance-changed' | 'requested';
  snapshot: HostHydrationSnapshot;
};

export type HostWireErrorCode =
  | 'bad-message'
  | 'protocol-mismatch'
  | 'authentication-required'
  | 'not-authenticated'
  | 'command-not-allowed'
  | 'request-failed'
  | 'replay-failed';

export type HostErrorFrame = {
  type: 'error';
  requestId?: string;
  code: HostWireErrorCode;
  message: string;
};

export type HostWireMessage =
  | HostClientHello
  | HostHello
  | HostCommandFrame
  | HostResponseFrame
  | HostPushFrame
  | HostPushBatchFrame
  | HostReplayFrame
  | HostReplayDoneFrame
  | HostSnapshotFrame
  | HostHydrationFrame
  | HostErrorFrame;
