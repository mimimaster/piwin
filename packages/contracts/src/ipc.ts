/** Desktop/CLI host IPC surface (M2 bridge). Transport-agnostic. */

import type { HostContentCommand } from './ipc-commands-content.js';
import type { HostRuntimeCommand } from './ipc-commands-runtime.js';
import type { HostSessionCommand } from './ipc-commands-session.js';
import type { HostTurnChangeCommand } from './ipc-commands-turn-changes.js';
import type { SubscriptionAuthCommand } from './subscription-oauth.js';

export type { HostContentCommand, HostRuntimeCommand, HostSessionCommand, HostTurnChangeCommand };
export type {
  MediaReadCommandInput,
  MediaSaveCommandInput,
} from './ipc-commands-content.js';
export type {
  HostPush,
  HostPushSequencing,
  HostPushVariant,
} from './ipc-push.js';
export type {
  HostPushBatchFrame,
  HostResponse,
  HostSequencedPush,
  HostServerMessage,
} from './ipc-envelope.js';
export {
  REMOTE_MEDIA_ASSET_PREFIX,
  toMediaAttachmentRef,
} from './ipc-response-data.js';
export type {
  ConfigGetData,
  ExtensionsApplyData,
  ExtensionsEnsureBundledData,
  ExtensionsInstallData,
  ExtensionsListData,
  ExtensionsSetEnabledData,
  GitBranchListData,
  GitDiffSummaryData,
  GitLogGraphData,
  GitMutationData,
  GitStatusData,
  HostRuntimeResourcesData,
  HostStatusData,
  McpGetData,
  McpListToolsData,
  McpSaveData,
  McpStartData,
  McpStatusData,
  McpStopData,
  McpValidateData,
  MediaSaveAssetForPrompt,
  MediaSaveData,
  PromptsListData,
  PromptsSetEnabledData,
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageReconcileResult,
  SessionColdStorageRestoreResult,
  SessionColdStorageStatus,
  SessionCompactData,
  SessionCompactExportResultData,
  SessionCompactionSettingsData,
  SessionCreateData,
  SessionExportResultData,
  SessionListData,
  SessionPackCreateResultData,
  SessionPackListData,
  SessionPackListItem,
  SessionPackManifestV1,
  SessionPackVerifyResultData,
  SessionPinData,
  SessionSearchData,
  SessionTruncateFromData,
  SessionUnpinData,
  SkillsInstallData,
  SkillsListData,
  SkillsSetEnabledData,
  ThemeActiveData,
  ThemeInstallData,
  ThemeListData,
} from './ipc-response-data.js';

/** UI / external client → host */
export type HostCommand =
  | SubscriptionAuthCommand
  | HostRuntimeCommand
  | HostSessionCommand
  | HostContentCommand
  | HostTurnChangeCommand;
