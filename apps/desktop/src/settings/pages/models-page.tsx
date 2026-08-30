/** Settings → unified model configuration workspace. */
import { useState, type ReactElement, type ReactNode } from 'react';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';
import type { ModelConfigEntry, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import { StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@piwin/ui-kit';
import { ProviderSettings } from '../../ProviderSettings';
import { VisionDelegationSettings } from '../../VisionDelegationSettings';
import { ReplyWriterSettings } from '../../ReplyWriterSettings';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { VideoGenerationSettings } from '../../VideoGenerationSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';
import { AsrModelSettings } from '../asr-model-settings.js';

type ModelTab = 'text' | 'vision' | 'writer' | 'image' | 'video' | 'speech';
type CapabilityKind = ModelTab;

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
  let issueCount = activeProviderCount === 0 || !chatDefault ? 1 : 0;
  if (imageTargets.length > 0 && !imageDefault) issueCount += 1;
  if (videoTargets.length > 0 && !videoDefault) issueCount += 1;
  if (speechRef && !speechDefault) issueCount += 1;

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
    issueCount,
    chatDefaultLabel: targetLabel(chatDefault),
    imageDefaultLabel: targetLabel(imageDefault),
    videoDefaultLabel: targetLabel(videoDefault),
    speechDefaultLabel: targetLabel(speechDefault),
  };
}

export function ModelsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const {
    config,
    saving,
    saveConfig,
    setError,
    setInfo,
    discoverProviderModels,
    testProviderModel,
    searchModelCatalog,
    storeProviderSecret,
    remoteSettingsReadOnly,
    hostClient,
  } = useSettings();
  const [activeTab, setActiveTab] = useState<ModelTab>('text');

  if (!config) {
    return (
      <p className="muted" data-testid="settings-models-loading">
        {isChinese ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  const summary = buildModelWorkspaceSummary(config);
  const unsetLabel = isChinese ? '未设置默认模型' : 'No default selected';

  return (
    <div className="settings-models-page" data-testid="settings-models">
      <section className="model-management" data-testid="settings-model-management">
        <div className="model-workspace-intro">
          <p>
            {isChinese
              ? '集中管理对话、视觉、生图、视频与语音模型。支持多通道挂载、端点协议自定义与默认模型调度。'
              : 'Centrally configure chat, vision, image, video, and speech models with custom wire protocols and defaults.'}
          </p>
          <StatusBadge
            tone={summary.issueCount === 0 ? 'success' : 'warning'}
            label={
              summary.issueCount === 0
                ? isChinese
                  ? '配置就绪'
                  : 'Ready'
                : isChinese
                  ? `${summary.issueCount} 项待处理`
                  : `${summary.issueCount} need attention`
            }
            testId="model-workspace-health"
          />
        </div>

        <div className="model-workspace-overview" data-testid="model-workspace-overview">
          <OverviewMetric
            label={isChinese ? '接口通道' : 'Provider channels'}
            value={`${summary.activeProviderCount} / ${summary.providerCount}`}
            detail={isChinese ? '已启用 / 全部' : 'active / total'}
          />
          <OverviewMetric
            label={isChinese ? '可用模型' : 'Available models'}
            value={`${summary.enabledModelCount} / ${summary.modelCount}`}
            detail={isChinese ? '已启用 / 全部' : 'enabled / total'}
          />
          <OverviewMetric
            label={isChinese ? '能力默认值' : 'Capability defaults'}
            value={`${summary.readyDefaultCount} / ${summary.applicableDefaultCount}`}
            detail={isChinese ? '已配置 / 适用' : 'ready / applicable'}
          />
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ModelTab)}
          className="model-workspace-tabs"
          testId="model-config-tabs"
        >
          <TabsList
            className="model-workspace-nav"
            label={isChinese ? '模型能力' : 'Model capabilities'}
          >
            <WorkspaceNavItem
              value="text"
              kind="text"
              title={isChinese ? '模型配置' : 'Channels & chat'}
              description={
                isChinese ? '密钥、接口和对话默认模型' : 'Keys, endpoints, and chat default'
              }
              count={summary.textModelCount}
              defaultLabel={summary.chatDefaultLabel ?? unsetLabel}
              testId="model-config-tab-text"
            />
            <WorkspaceNavItem
              value="vision"
              kind="vision"
              title={isChinese ? '视觉委派' : 'Vision'}
              description={
                isChinese ? '纯文本模型的多模态图片转写' : 'Multimodal description for text models'
              }
              count={config.visionDelegation?.enabled ? 1 : 0}
              defaultLabel={config.visionDelegation?.enabled ? (isChinese ? '已启用' : 'Enabled') : (isChinese ? '未启用' : 'Disabled')}
              testId="model-config-tab-vision"
            />
            <WorkspaceNavItem
              value="writer"
              kind="writer"
              title={isChinese ? '输出委托' : 'Reply writer'}
              description={
                isChinese ? '干活模型之后用写作模型改写可见回复' : 'Rewrite the visible reply after the worker turn'
              }
              count={config.replyWriter?.enabled ? 1 : 0}
              defaultLabel={config.replyWriter?.enabled ? (isChinese ? '已启用' : 'Enabled') : (isChinese ? '未启用' : 'Disabled')}
              testId="model-config-tab-writer"
            />
            <WorkspaceNavItem
              value="image"
              kind="image"
              title={isChinese ? '图片生成' : 'Images'}
              description={
                isChinese ? '生图路由、模型和调用测试' : 'Routes, models, and call tests'
              }
              count={summary.imageModelCount}
              defaultLabel={summary.imageDefaultLabel ?? unsetLabel}
              testId="model-config-tab-image"
            />
            <WorkspaceNavItem
              value="video"
              kind="video"
              title={isChinese ? '视频生成' : 'Video'}
              description={isChinese ? '异步任务接口和默认模型' : 'Async APIs and video default'}
              count={summary.videoModelCount}
              defaultLabel={summary.videoDefaultLabel ?? unsetLabel}
              testId="model-config-tab-video"
            />
            <WorkspaceNavItem
              value="speech"
              kind="speech"
              title={isChinese ? '语音能力' : 'Speech'}
              description={isChinese ? 'piwin Live 实时语音' : 'piwin Live realtime voice'}
              count={summary.speechModelCount}
              defaultLabel={isChinese ? 'Live' : 'Live'}
              testId="model-config-tab-speech"
            />
          </TabsList>

          <TabsContent
            value="text"
            className="model-management-tab-content"
            testId="model-config-panel-text"
          >
            <div className="settings-card settings-card-flush" data-testid="settings-provider-card">
              <ProviderSettings
                config={config}
                saving={saving || remoteSettingsReadOnly === true}
                onSave={saveConfig}
                onError={setError}
                onInfo={setInfo}
                onDiscoverModels={discoverProviderModels}
                onTestModel={testProviderModel}
                onStoreSecret={storeProviderSecret}
                searchCatalog={async (query) => {
                  const result = await searchModelCatalog({ query, limit: 12 });
                  return result.entries;
                }}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="vision"
            className="model-management-tab-content"
            testId="model-config-panel-vision"
          >
            <div className="settings-section settings-section-card" data-testid="settings-vision-page">
              <VisionDelegationSettings />
            </div>
          </TabsContent>

          <TabsContent
            value="writer"
            className="model-management-tab-content"
            testId="model-config-panel-writer"
          >
            <div className="settings-section settings-section-card" data-testid="settings-reply-writer-page">
              <ReplyWriterSettings />
            </div>
          </TabsContent>

          <TabsContent
            value="image"
            className="model-management-tab-content"
            testId="model-config-panel-image"
          >
            <ImageGenerationSettings />
          </TabsContent>

          <TabsContent
            value="video"
            className="model-management-tab-content"
            testId="model-config-panel-video"
          >
            <VideoGenerationSettings />
          </TabsContent>

          <TabsContent
            value="speech"
            className="model-management-tab-content"
            testId="model-config-panel-speech"
          >
            <AsrModelSettings
              config={config}
                saving={saving || remoteSettingsReadOnly === true}
              onSave={saveConfig}
              onError={setError}
              onInfo={setInfo}
              {...(hostClient?.request
                ? {
                    hostRequest: (command) => {
                      const request = hostClient.request;
                      if (!request) return Promise.reject(new Error('host unavailable'));
                      return request(command);
                    },
                  }
                : {})}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

function OverviewMetric(props: {
  label: string;
  value: string;
  detail: string;
  compact?: boolean;
}): ReactElement {
  return (
    <div className="model-workspace-metric">
      <span className="model-workspace-metric-label">{props.label}</span>
      <strong className={props.compact ? 'is-compact' : undefined}>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}

function WorkspaceNavItem(props: {
  value: ModelTab;
  kind: CapabilityKind;
  title: string;
  description: string;
  count: number;
  defaultLabel: string;
  testId: string;
}): ReactElement {
  return (
    <TabsTrigger value={props.value} className="model-workspace-nav-item" testId={props.testId}>
      <ModelCapabilityIcon kind={props.kind} />
      <span className="model-workspace-nav-copy">
        <span className="model-workspace-nav-title">
          <strong>{props.title}</strong>
          <span>{props.count}</span>
        </span>
        <small>{props.description}</small>
        <em title={props.defaultLabel}>{props.defaultLabel}</em>
      </span>
    </TabsTrigger>
  );
}

function ModelCapabilityIcon(props: { kind: CapabilityKind }): ReactElement {
  const paths: Record<CapabilityKind, ReactNode> = {
    text: (
      <>
        <path d="M5 6.5h14M5 11.5h9M5 16.5h6" />
        <path d="M4 3.5h16a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 20 20.5H4A1.5 1.5 0 0 1 2.5 19V5A1.5 1.5 0 0 1 4 3.5Z" />
      </>
    ),
    vision: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    writer: (
      <>
        <path d="M4 19.5 14.5 9 17 11.5 6.5 22H4z" />
        <path d="m13.2 7.7 2.3-2.3a1.5 1.5 0 0 1 2.1 0l1 1a1.5 1.5 0 0 1 0 2.1l-2.3 2.3" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m4.5 18 5-5 3 3 2.5-2.5 4.5 4.5" />
      </>
    ),
    video: (
      <>
        <rect x="3" y="5" width="14" height="14" rx="2.5" />
        <path d="m17 10 4-2.5v9L17 14" />
        <path d="m9 9 4 3-4 3Z" />
      </>
    ),
    speech: (
      <>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 10.5V12a6.5 6.5 0 0 0 13 0v-1.5M12 18.5V22M8.5 22h7" />
      </>
    ),
  };
  return (
    <span className={`model-workspace-nav-icon is-${props.kind}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65">
        {paths[props.kind]}
      </svg>
    </span>
  );
}
