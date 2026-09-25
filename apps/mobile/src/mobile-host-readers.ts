import {
  readConfiguredChatModelsData,
  type ConfiguredChatModel,
  type ConfiguredChatModelsData,
  type HostResponse,
  type KnowledgeBaseSummary,
  type KnowledgeSearchResult,
  type SessionPlan,
  type RemoteHostStatusData,
  type RemoteMediaAsset,
  type RemoteProjectSummary,
  type RemoteSessionSummary,
  type WalkthroughArtifact,
  type WikiConceptDetail,
  type WikiOverviewResult,
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

/** Read a Host-owned plan snapshot without trusting arbitrary remote JSON. */
export function readSessionPlan(response: HostResponse): SessionPlan | null {
  if (!response.success || !isRecord(response.data)) {
    return null;
  }
  const value = response.data.plan;
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.projectPath !== 'string' ||
    !isPlanStatus(value.status) ||
    typeof value.title !== 'string' ||
    typeof value.goal !== 'string' ||
    !Array.isArray(value.steps) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isPlanSource(value.source)
  ) {
    return null;
  }
  const steps = value.steps.filter(isPlanStep);
  if (steps.length !== value.steps.length) {
    return null;
  }
  return {
    id: value.id,
    sessionId: value.sessionId,
    projectPath: value.projectPath,
    status: value.status,
    title: value.title,
    goal: value.goal,
    steps,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    source: value.source,
    ...(typeof value.skillId === 'string' ? { skillId: value.skillId } : {}),
    ...(value.complexity === 'short' || value.complexity === 'long'
      ? { complexity: value.complexity }
      : {}),
    ...(Array.isArray(value.independentSteps) &&
    value.independentSteps.every((step) => typeof step === 'string')
      ? { independentSteps: value.independentSteps }
      : {}),
    ...(isPlanExecutionState(value.execution) ? { execution: value.execution } : {}),
  };
}

/** Read the unified knowledge registry without trusting an arbitrary Host payload. */
export function readKnowledgeBases(response: HostResponse): KnowledgeBaseSummary[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.bases)) {
    return [];
  }
  return response.data.bases.filter(isKnowledgeBaseSummary);
}

export function readKnowledgeBase(response: HostResponse): KnowledgeBaseSummary | undefined {
  if (!response.success || !isRecord(response.data) || !isKnowledgeBaseSummary(response.data.base)) {
    return undefined;
  }
  return response.data.base;
}

export function readKnowledgeSearchResult(response: HostResponse): KnowledgeSearchResult {
  if (!response.success || !isRecord(response.data)) {
    return { citations: [], degradedBaseIds: [], skipped: [] };
  }
  const citations = Array.isArray(response.data.citations)
    ? response.data.citations.filter(isKnowledgeCitation)
    : [];
  const degradedBaseIds = Array.isArray(response.data.degradedBaseIds)
    ? response.data.degradedBaseIds.filter((id): id is string => typeof id === 'string')
    : [];
  const skipped = Array.isArray(response.data.skipped)
    ? response.data.skipped.filter(
        (value): value is KnowledgeSearchResult['skipped'][number] =>
          isRecord(value) && typeof value.baseId === 'string' && typeof value.reason === 'string',
      )
    : [];
  return { citations, degradedBaseIds, skipped };
}

export function readWikiOverview(response: HostResponse): WikiOverviewResult | undefined {
  if (!response.success || !isRecord(response.data)) {
    return undefined;
  }
  if (
    typeof response.data.indexContent !== 'string' ||
    typeof response.data.logSnippet !== 'string' ||
    typeof response.data.totalConcepts !== 'number'
  ) {
    return undefined;
  }
  const concepts = Array.isArray(response.data.concepts)
    ? response.data.concepts.filter(isWikiConceptItem)
    : [];
  return {
    indexContent: response.data.indexContent,
    logSnippet: response.data.logSnippet,
    concepts,
    totalConcepts: response.data.totalConcepts,
  };
}

export function readWikiConcept(response: HostResponse): WikiConceptDetail | undefined {
  if (!response.success || !isRecord(response.data) || !isRecord(response.data.concept)) {
    return undefined;
  }
  return isWikiConceptDetail(response.data.concept) ? response.data.concept : undefined;
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

function isPlanStatus(value: unknown): value is SessionPlan['status'] {
  return (
    value === 'draft' ||
    value === 'approved' ||
    value === 'executing' ||
    value === 'done' ||
    value === 'abandoned'
  );
}

function isPlanSource(value: unknown): value is SessionPlan['source'] {
  return value === 'user' || value === 'assistant' || value === 'skill';
}

function isPlanStep(value: unknown): value is SessionPlan['steps'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    (value.status === 'pending' ||
      value.status === 'active' ||
      value.status === 'done' ||
      value.status === 'skipped') &&
    (value.profileId === undefined || typeof value.profileId === 'string') &&
    (value.dependsOn === undefined ||
      (Array.isArray(value.dependsOn) && value.dependsOn.every((id) => typeof id === 'string'))) &&
    (value.parallelGroup === undefined || typeof value.parallelGroup === 'string')
  );
}

function isPlanExecutionState(value: unknown): value is NonNullable<SessionPlan['execution']> {
  if (!isRecord(value)) return false;
  return (
    typeof value.sessionId === 'string' &&
    typeof value.planId === 'string' &&
    (value.mode === 'inline' || value.mode === 'subagent-driven') &&
    (value.status === 'idle' ||
      value.status === 'queued' ||
      value.status === 'running' ||
      value.status === 'completed' ||
      value.status === 'failed' ||
      value.status === 'aborted') &&
    Array.isArray(value.childSessionIds) &&
    value.childSessionIds.every((id) => typeof id === 'string') &&
    (value.runId === undefined || typeof value.runId === 'string') &&
    (value.currentStepId === undefined || typeof value.currentStepId === 'string') &&
    (value.error === undefined || typeof value.error === 'string')
  );
}

function isKnowledgeBaseSummary(value: unknown): value is KnowledgeBaseSummary {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'notes' || value.kind === 'folder' || value.kind === 'wiki') &&
    typeof value.name === 'string' &&
    typeof value.state === 'string' &&
    typeof value.degraded === 'boolean' &&
    typeof value.documentCount === 'number'
  );
}

function isKnowledgeCitation(value: unknown): value is KnowledgeSearchResult['citations'][number] {
  return (
    isRecord(value) &&
    typeof value.ref === 'number' &&
    typeof value.baseId === 'string' &&
    typeof value.baseName === 'string' &&
    typeof value.title === 'string' &&
    typeof value.text === 'string'
  );
}

function isWikiConceptItem(value: unknown): value is WikiOverviewResult['concepts'][number] {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.slug === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    typeof value.updatedAt === 'string' &&
    typeof value.relativePath === 'string'
  );
}

function isWikiConceptDetail(value: unknown): value is WikiConceptDetail {
  return (
    isRecord(value) &&
    typeof value.title === 'string' &&
    typeof value.slug === 'string' &&
    typeof value.content === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    Array.isArray(value.links) &&
    value.links.every((link) => typeof link === 'string') &&
    typeof value.updatedAt === 'string' &&
    typeof value.relativePath === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `walkthrough/list` artifacts; unknown statuses are dropped, never guessed. */
export function readWalkthroughArtifacts(response: HostResponse): WalkthroughArtifact[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.artifacts)) {
    return [];
  }
  return response.data.artifacts.filter((artifact): artifact is WalkthroughArtifact => {
    if (!isRecord(artifact) || typeof artifact.id !== 'string' || typeof artifact.status !== 'string') {
      return false;
    }
    return artifact.status === 'generating' || artifact.status === 'ready' || artifact.status === 'error';
  });
}
