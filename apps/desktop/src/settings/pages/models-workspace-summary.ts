/**
 * Pure summary of the Models workspace: counts for the readout line, the
 * default model per capability, and what still needs attention (each issue
 * names the capability tab that fixes it).
 */
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';
import type { ModelConfigEntry, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';

export type ModelTab = 'text' | 'vision' | 'writer' | 'image' | 'video' | 'speech';

export type ModelWorkspaceIssue = {
  tab: ModelTab;
  kind: 'no-provider' | 'no-chat-default' | 'no-image-default' | 'no-video-default' | 'speech-default-unavailable';
};

type ModelTarget = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
};

export type ModelWorkspaceSummary = {
  providerCount: number;
  activeProviderCount: number;
  modelCount: number;
  enabledModelCount: number;
  textModelCount: number;
  imageModelCount: number;
  videoModelCount: number;
  speechModelCount: number;
  readyDefaultCount: number;
  applicableDefaultCount: number;
  issueCount: number;
  issues: ModelWorkspaceIssue[];
  chatDefaultLabel: string | null;
  imageDefaultLabel: string | null;
  videoDefaultLabel: string | null;
  speechDefaultLabel: string | null;
};

function isImageModel(model: ModelConfigEntry): boolean {
  return (
    model.capabilities?.includes('image-generation') === true ||
    model.routes?.['image-generation'] !== undefined
  );
}

function isVideoModel(model: ModelConfigEntry): boolean {
  return (
    model.capabilities?.includes('video-generation') === true ||
    model.routes?.['video-generation'] !== undefined
  );
}

function isSpeechModel(model: ModelConfigEntry): boolean {
  return (
    model.capabilities?.includes('speech-to-text') === true ||
    model.capabilities?.includes('text-to-speech') === true
  );
}

function enabledTargets(config: PiwinConfig): ModelTarget[] {
  return config.providers.flatMap((provider) =>
    isProviderEnabled(provider)
      ? provider.models
          .filter((model) => isModelEnabled(model))
          .map((model) => ({ provider, model }))
      : [],
  );
}

function resolveDefaultTarget(
  config: PiwinConfig,
  providerId: string | undefined,
  modelId: string | undefined,
  supports: (model: ModelConfigEntry) => boolean,
): ModelTarget | null {
  if (!providerId || !modelId) return null;
  const provider = config.providers.find(
    (candidate) => candidate.id === providerId && isProviderEnabled(candidate),
  );
  const model = provider?.models.find(
    (candidate) => candidate.id === modelId && isModelEnabled(candidate) && supports(candidate),
  );
  return provider && model ? { provider, model } : null;
}

function targetLabel(target: ModelTarget | null): string | null {
  return target ? (target.model.label ?? target.model.id) : null;
}

export function buildModelWorkspaceSummary(config: PiwinConfig): ModelWorkspaceSummary {
  const targets = enabledTargets(config);
  const textTargets = targets.filter(({ model }) => modelSupportsCapability(model, 'chat'));
  const imageTargets = targets.filter(({ model }) => isImageModel(model));
  const videoTargets = targets.filter(({ model }) => isVideoModel(model));
  const speechTargets = targets.filter(({ model }) => isSpeechModel(model));

  const chatDefault = resolveDefaultTarget(
    config,
    config.defaultProviderId,
    config.defaultModelId,
    (model) => modelSupportsCapability(model, 'chat'),
  );
  const imageRef = config.imageGeneration?.defaultModel;
  const imageDefault = resolveDefaultTarget(
    config,
    imageRef?.providerId,
    imageRef?.modelId,
    isImageModel,
  );
  const videoRef = config.videoGeneration?.defaultModel;
  const videoDefault = resolveDefaultTarget(
    config,
    videoRef?.providerId,
    videoRef?.modelId,
    isVideoModel,
  );
  const speechRef = config.speech?.asr?.defaultModel;
  const speechDefault = resolveDefaultTarget(
    config,
    speechRef?.providerId,
    speechRef?.modelId,
    (model) => model.capabilities?.includes('speech-to-text') === true,
  );

  const activeProviderCount = config.providers.filter((provider) =>
    isProviderEnabled(provider),
  ).length;
  const issues: ModelWorkspaceIssue[] = [];
  if (activeProviderCount === 0) issues.push({ tab: 'text', kind: 'no-provider' });
  else if (!chatDefault) issues.push({ tab: 'text', kind: 'no-chat-default' });
  if (imageTargets.length > 0 && !imageDefault) issues.push({ tab: 'image', kind: 'no-image-default' });
  if (videoTargets.length > 0 && !videoDefault) issues.push({ tab: 'video', kind: 'no-video-default' });
  if (speechRef && !speechDefault) issues.push({ tab: 'speech', kind: 'speech-default-unavailable' });

  const applicableDefaultCount =
    1 +
    (imageTargets.length > 0 ? 1 : 0) +
    (videoTargets.length > 0 ? 1 : 0) +
    (speechTargets.some(({ model }) => model.capabilities?.includes('speech-to-text')) ? 1 : 0);
  const readyDefaultCount =
    (chatDefault ? 1 : 0) +
    (imageTargets.length > 0 && imageDefault ? 1 : 0) +
    (videoTargets.length > 0 && videoDefault ? 1 : 0) +
    (speechTargets.some(({ model }) => model.capabilities?.includes('speech-to-text')) &&
    speechDefault
      ? 1
      : 0);

  return {
    providerCount: config.providers.length,
    activeProviderCount,
    modelCount: config.providers.reduce((total, provider) => total + provider.models.length, 0),
    enabledModelCount: targets.length,
    textModelCount: textTargets.length,
    imageModelCount: imageTargets.length,
    videoModelCount: videoTargets.length,
    speechModelCount: speechTargets.length,
    readyDefaultCount,
    applicableDefaultCount,
    issueCount: issues.length,
    issues,
    chatDefaultLabel: targetLabel(chatDefault),
    imageDefaultLabel: targetLabel(imageDefault),
    videoDefaultLabel: targetLabel(videoDefault),
    speechDefaultLabel: targetLabel(speechDefault),
  };
}

