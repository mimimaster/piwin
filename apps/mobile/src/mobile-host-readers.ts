import {
  readConfiguredChatModelsData,
  type ConfiguredChatModel,
  type ConfiguredChatModelsData,
  type HostResponse,
  type RemoteHostStatusData,
  type RemoteMediaAsset,
  type RemoteProjectSummary,
  type RemoteSessionSummary,
} from '@piwin/contracts';
import { isRemoteHostStatusData } from './mobile-host-connection.js';

export function applyHostStatus(
  response: HostResponse,
  setStatus: (status: RemoteHostStatusData) => void,
  setError: (message: string | undefined) => void,
): void {
  if (!response.success) {
    setError(response.error);
    return;
  }
  if (!isRemoteHostStatusData(response.data)) {
    setError('Host 返回了无法识别的状态数据。');
    return;
  }
  setStatus(response.data);
}

export function applyConfiguredModels(
  response: HostResponse,
  setModels: (models: ConfiguredChatModel[]) => void,
  setDefaultProviderId: (providerId: string | undefined) => void,
  setDefaultModelId: (modelId: string | undefined) => void,
): void {
  const data = readConfiguredChatModels(response);
  setModels(data.models);
  setDefaultProviderId(data.defaultProviderId);
  setDefaultModelId(data.defaultModelId);
}

export function readConfiguredChatModels(response: HostResponse): ConfiguredChatModelsData {
  if (!response.success) {
    return { models: [] };
  }
  return readConfiguredChatModelsData(response.data);
}

export function readProjects(response: HostResponse): RemoteProjectSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.projects)) {
    return [];
  }
  return response.data.projects.filter(isRemoteProjectSummary);
}

export function readSessions(response: HostResponse): RemoteSessionSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.sessions)) {
    return [];
  }
  return response.data.sessions.filter(isRemoteSessionSummary);
}

export function readRunId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.runId === 'string' ? value.runId : undefined;
}

export function readPauseCheckpointId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.pauseCheckpoint)) {
    return undefined;
  }
  return typeof value.pauseCheckpoint.checkpointId === 'string'
    ? value.pauseCheckpoint.checkpointId
    : undefined;
}

/** `config.artifact.enabled` from `settings/get`. Missing config keeps previews on. */
export function readArtifactEnabled(response: HostResponse): boolean {
  if (!response.success || !isRecord(response.data)) {
    return true;
  }
  const snapshot = isRecord(response.data.snapshot) ? response.data.snapshot : undefined;
  const config = isRecord(snapshot?.config)
    ? snapshot.config
    : isRecord(response.data.config)
      ? response.data.config
      : undefined;
  if (!isRecord(config) || !isRecord(config.artifact)) {
    return true;
  }
  return config.artifact.enabled !== false;
}

export function readRemoteMediaAsset(value: unknown): RemoteMediaAsset | undefined {
  if (!isRecord(value) || !isRecord(value.asset)) {
    return undefined;
  }
  const asset = value.asset;
  if (
    typeof asset.id !== 'string' ||
    asset.id.length === 0 ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.byteSize !== 'number' ||
    asset.byteSize < 0
  ) {
    return undefined;
  }
  const projected: RemoteMediaAsset = {
    id: asset.id,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
  };
  if (typeof asset.name === 'string' && asset.name.length > 0) {
    projected.name = asset.name;
  }
  if (asset.contentKind === 'image' || asset.contentKind === 'text' || asset.contentKind === 'document') {
    projected.contentKind = asset.contentKind;
  }
  if (typeof asset.width === 'number' && Number.isFinite(asset.width) && asset.width > 0) {
    projected.width = asset.width;
  }
  if (typeof asset.height === 'number' && Number.isFinite(asset.height) && asset.height > 0) {
    projected.height = asset.height;
  }
  return projected;
}

function isRemoteProjectSummary(value: unknown): value is RemoteProjectSummary {
  return (
    isRecord(value) && typeof value.projectId === 'string' && typeof value.displayName === 'string'
  );
}

function isRemoteSessionSummary(value: unknown): value is RemoteSessionSummary {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    (value.scope === 'general' || value.scope === 'project' || value.scope === 'unknown')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
