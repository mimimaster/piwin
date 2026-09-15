import type {
  AgentMessageRole,
  HostMode,
  MediaAttachmentRef,
  ModelRef,
  PermissionDecision,
  ToolPresentation,
} from './host.js';
import type { HostOsFamily, HostPathStyle } from './host-platform.js';
import type { AttachmentContentKind } from './attachment.js';
import type { HostCommand, HostPush, HostPushBatchFrame, HostResponse } from './ipc.js';
import type { QueuedTurnRecord } from './queued-turn.js';
import type { TrustedDeviceCredential } from './remote.js';
import type { SessionListPageResult } from './session-list-page.js';
import type {
  ClientToolCancelFrame,
  ClientToolCapabilitiesFrame,
  ClientToolCapabilityAdvertisement,
  ClientToolRequestFrame,
  ClientToolResultFrame,
} from './client-tool.js';

/**
 * The first version of the private shell-to-host wire protocol.
 * Client-tool frames are additive optional fields/types under version 1:
 * they are sent only after bilateral capability negotiation. Changing frame
 * meaning or authentication requires a new protocol version.
 */
export const HOST_PROTOCOL_VERSION = 1 as const;

export type HostProtocolVersion = typeof HOST_PROTOCOL_VERSION;

export type HostClientType = 'mobile' | 'desktop' | 'cli' | 'web';

/** Capabilities a client advertises before the server selects batch framing. */
export type HostClientCapabilities = {
  pushBatching?: boolean;
  cursorBatches?: boolean;
  boundedReplay?: boolean;
  hydration?: boolean;
  /**
   * Client will send `client/subscriptions` and accepts filtered live
   * session streams. Absent on old clients (full fan-out).
   */
  liveSubscriptions?: boolean;
  /** Bounded device-tool advertisements. Absent on old clients. */
  clientTools?: readonly ClientToolCapabilityAdvertisement[];
  /**
   * Client can receive the out-of-band binary browser-frame channel
   * (`version + headerLength + JSON header + JPEG`). Absent on old clients,
   * which receive an explicit unavailable payload instead of `[redacted]`.
   */
  browserFrameBinary?: true;
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
  /** One-use enrollment material; accepted only by a Host with pairing enabled. */
  pairingToken?: string;
  /** Host-issued credential for a previously paired device. */
  deviceCredential?: TrustedDeviceCredential;
  /** Human-readable device name used only during pairing enrollment. */
  deviceName?: string;
};

export type HostClientSubscriptions = {
  sessionIds?: string[];
};

/**
 * Historical subset kept for tests that still name it. Hello that omits
 * `allowedCommands` means the admitted client is the operator: every command
 * is on. A present list is still honored as an explicit ceiling.
 */
export const FALLBACK_REMOTE_ALLOWED_COMMANDS = [
  'host/ping',
  'host/status',
  'activity/summary',
  'project/list',
  'project/remove',
  'session/list',
  'session/list-page',
  'session/create',
  'session/resume',
  'session/user-message-index',
  'session/transcript-page',
  'session/transcript-window',
  'session/messages',
  'session/queued-turn-submit',
  'session/queued-turn-list',
  'session/queued-turn-edit',
  'session/queued-turn-cancel',
  'session/queued-turn-reorder',
  'session/replace-run',
  'session/model-context-summary',
  'session/context-get',
  'models/configured',
  'auth/status',
  'auth/login',
  'auth/respond',
  'auth/cancel',
  'auth/claim',
  'auth/logout',
  'pi-environment/detect',
  'pi-environment/preview',
  'pi-environment/apply',
  'models/discover',
  'models/test',
  'models/image-test',
  'models/catalog/search',
  'secrets/set',
  'secrets/get',
  'web/test-search-source',
  'web/search-route-preview',
  'settings/get',
  'settings/apply',
  'session/prompt',
  'session/pause',
  'session/resume-run',
  'session/abort',
  'session/steer',
  'session/follow_up',
  'run/intervention-submit',
  'run/intervention-edit',
  'run/intervention-cancel',
  'session/runtime-status',
  'session/pin',
  'session/unpin',
  'session/rename',
  'session/set-composer-profile',
  'session/archive',
  'session/unarchive',
  'session/delete',
  'session/tool-output',
  'session/cold-storage-status',
  'session/cold-storage-plan',
  'session/cold-storage-execute',
  'session/cold-storage-restore',
  'session/cold-storage-import',
  'session/cold-storage-reconcile',
  'permission/resolve',
  'media/save',
  'media/save-begin',
  'media/save-chunk',
  'media/save-finish',
  'media/save-abort',
  'media/read',
  'media/list',
  'media/delete',
  'preview/read-trusted-text',
  'skills/read',
  'extensions/list',
  'flashcards/study/catalog',
  'flashcards/study/start',
  'flashcards/study/get',
  'flashcards/study/claim',
  'flashcards/study/checkpoint',
  'flashcards/study/next',
  'flashcards/study/rate',
  'flashcards/study/undo',
  'flashcards/study/pause',
  'flashcards/study/resume',
  'flashcards/study/end',
  'flashcards/study/operation',
] as const satisfies readonly HostCommand['type'][];

/** True when this Host advertised the command, or omitted the ceiling (operator). */
export function remoteHostSupportsCommand(
  allowedCommands: readonly HostCommand['type'][] | undefined,
  type: HostCommand['type'],
): boolean {
  if (allowedCommands === undefined) {
    return true;
  }
  return allowedCommands.includes(type);
}

export type RemoteCapabilitySummary = {
  /**
   * Exact command ceiling selected by the Host for this connection.
   * Omitted means the admitted client is the operator (every command).
   * A present list is an explicit ceiling; the Host still enforces payload
   * checks independently.
   */
  allowedCommands?: readonly HostCommand['type'][];
  pushSequencing: boolean;
  replay: boolean;
  snapshot: boolean;
  sessionRead: boolean;
  sessionControl: boolean;
  sessionPause?: boolean;
  permissionResolve: boolean;
  mediaUpload: boolean;
  /** Remote-safe media vault byte fetch by logical asset id (ADR 0052). */
  mediaRead?: boolean;
  /** Remote-safe config-root text preview by relative path (ADR 0052 Slice 3). */
  trustedTextPreview?: boolean;
  pushBatching?: boolean;
  cursorBatches?: boolean;
  boundedReplay?: boolean;
  hydration?: boolean;
  /** Remote-safe logical Skill preview (sessionId + skillId only). */
  skillPreview?: boolean;
  /** Bounded persisted tool output snapshot recovery. */
  toolOutputRead?: boolean;
  /** Host maintains a bounded user-message navigation index. */
  sessionUserMessageIndex?: boolean;
  /** Host supports bounded transcript windows around an anchor message. */
  sessionTranscriptSeek?: boolean;
  /** Assembly-only model context summaries (M1). */
  contextSummary?: boolean;
  /** Host exposes live context occupancy snapshots (ADR 0067). */
  contextTelemetryVersion?: 1;
  runInterventions?: boolean;
  queuedTurns?: boolean;
  /** Host honors session/prompt.foreground admission (if-idle / replace-run). */
  foregroundRunAdmission?: boolean;
  /** Host accepts path-free session/list.scopeRef (projectId / all-authorized). */
  logicalProjectRefs?: boolean;
  /** Host can hydrate activity/run state for reconnecting shells. */
  activityHydration?: boolean;
  /** Host carries live browser JPEG on the out-of-band binary channel. */
  browserFrameBinary?: boolean;
  /**
   * Host will send targeted client-tool request/cancel frames to this
   * connection. Absent on old Hosts; never implied by protocol version alone.
   */
  clientToolRequests?: boolean;
  /** Host accepts `client/subscriptions` and filters high-rate session pushes. */
  liveSubscriptions?: boolean;
  /** Host exposes `flashcards/study/*`. Absent on old Hosts — shells show 需要更新 Host. */
  flashcardStudy?: boolean;
  /** Host exposes `knowledge/*` bases, search, and session mounts. Absent on old Hosts. */
  knowledgeBases?: boolean;
  /**
   * OS family of the Host process (`process.platform`). Shells use this for
   * Host-path placeholders and joins — never the client OS.
   */
  platform?: HostOsFamily;
  /** Filesystem path style on the Host. Derived from `platform`. */
  pathStyle?: HostPathStyle;
  /** Host home directory. Used as the folder-picker start path. */
  homeDirectory?: string;
  /** Host accepts `host/list-dir` for the workspace folder picker. */
  hostListDir?: boolean;
};

export type HostHello = {
  type: 'host/hello';
  protocolVersion: HostProtocolVersion;
  hostInstanceId: string;
  currentSeq: number;
  authRequired: boolean;
  authenticated: boolean;
  capabilities: RemoteCapabilitySummary;
  /** Opaque Host build/revision for shell compatibility diagnostics. */
  hostBuildId?: string;
  /** When set, shells older than this should not keep auto-retrying. */
  minClientVersion?: string;
  /** Host-issued principal for a paired connection. */
  deviceId?: string;
  /** Returned only immediately after pairing enrollment. Never log this field. */
  deviceSecret?: string;
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
  /**
   * Host filesystem root. Remote shells need this for copy-absolute-path /
   * reveal; command addressing still accepts `projectId` via bindProjectLocator.
   */
  path?: string;
  trust?: 'trusted' | 'untrusted' | 'unknown';
  lastOpenedAt?: string;
  /** Opaque shared-repo id. Same for worktrees of one git repository. */
  gitRepositoryId?: string;
  isPrimaryWorktree?: boolean;
  currentBranch?: string;
  /** Git checkout root on the Host. Same for a subdirectory of one checkout. */
  gitRootPath?: string;
};

export type RemoteSessionScopeKind = 'general' | 'project' | 'unknown';

export type RemoteSessionSummary = {
  sessionId: string;
  name?: string;
  scope: RemoteSessionScopeKind;
  /** Opaque id from `project/list`. Present when `scope` is `project`. */
  projectId?: string;
  kind?: string;
  updatedAt?: string;
  messageCount?: number;
  lastPreview?: string;
  pinned?: boolean;
  archived?: boolean;
  /** Knowledge bases mounted on this session; omitted when none are mounted. */
  knowledgeBaseIds?: string[];
  parentSessionId?: string;
  subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
  task?: string;
  subagentRole?: string;
  subagentModel?: ModelRef;
  /** Remote-safe storage residency. Host pack paths are never included. */
  storage?: import('./session-storage.js').RemoteSessionStorageInfo;
};

export type RemoteSessionListData = {
  sessions: RemoteSessionSummary[];
  /** Filtered, ordered count before truncation. */
  totalCount: number;
  /** True when `sessions.length < totalCount`. */
  truncated: boolean;
};

export type RemoteSessionListPageData = SessionListPageResult<RemoteSessionSummary>;

export type RemoteTranscriptTool = {
  toolCallId: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  output: string;
  runId?: string;
  /**
   * Collapsed-row head fields. Host filesystem roots are redacted or reduced
   * to basenames; full tool output stays on `output`, not `presentation.output`.
   */
  presentation?: ToolPresentation;
};

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
  /** Immutable generation-time identity used by shells after history reload. */
  model?: ModelRef;
  tools?: RemoteTranscriptTool[];
  /**
   * Count kept for older clients / hydration size budgeting. Prefer
   * `attachments` (paths rewritten to `remote-asset:<id>`) for rendering.
   */
  attachmentCount?: number;
  /**
   * Media rows for transcript thumbs. Host absolute paths are rewritten to
   * opaque `remote-asset:<id>` refs; clients load bytes via `media/read`.
   */
  attachments?: MediaAttachmentRef[];
  instructionDelivery?: import('./session-transcript.js').SessionTranscriptMessage['instructionDelivery'];
};

/** Remote-safe media projection; Host filesystem paths never cross this boundary. */
export type RemoteMediaAsset = {
  id: string;
  mimeType: string;
  byteSize: number;
  name?: string;
  contentKind?: AttachmentContentKind;
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
  model?: ModelRef;
  thinkingLevel?: string;
  contextUsage?: import('./usage.js').ContextUsageSnapshot;
  contextSnapshot: import('./context-telemetry.js').SessionContextSnapshot;
  lastRequestUsage: import('./assistant-usage.js').AssistantUsageMeasurement | null;
  outline?: RemoteSessionOutlineNode[];
};

export type HostCommandFrame = {
  type: 'command';
  requestId: string;
  command: HostCommand;
  idempotencyKey?: string;
};

/** One Desktop Conversation workspace may keep all eight visible panes live. */
export const LIVE_SUBSCRIPTION_MAX_SESSION_IDS = 8 as const;

export type HostClientSubscriptionsFrame = {
  type: 'client/subscriptions';
  requestId: string;
  revision: number;
  subscriptions: HostClientSubscriptions;
};

export type HostSubscriptionsAppliedFrame = {
  type: 'subscriptions/applied';
  requestId: string;
  revision: number;
  fenceSeq: number;
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
  queuedTurnsBySession?: Record<string, QueuedTurnRecord[]>;
  pendingPermissions?: RemotePendingPermission[];
  truncatedSessionIds: string[];
};

export type RemotePendingPermission = {
  sessionId: string;
  requestId: string;
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  runId?: string;
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
  | HostErrorFrame
  | HostClientSubscriptionsFrame
  | HostSubscriptionsAppliedFrame
  | ClientToolRequestFrame
  | ClientToolResultFrame
  | ClientToolCancelFrame
  | ClientToolCapabilitiesFrame;

/**
 * Frames a client transport may send. Host-to-client request/cancel are
 * intentionally absent so the client outbound API cannot express them.
 */
export type HostClientOutboundFrame =
  | HostCommandFrame
  | HostReplayFrame
  | HostClientSubscriptionsFrame
  | ClientToolResultFrame
  | ClientToolCapabilitiesFrame;
