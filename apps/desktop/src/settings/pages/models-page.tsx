/** Settings → unified model configuration workspace. */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Tabs, TabsContent } from '@piwin/ui-kit';
import { ModelCatalogSyncControl } from '../model-catalog-sync-control';
import { ProviderSettings } from '../../ProviderSettings';
import { VisionDelegationSettings } from '../../VisionDelegationSettings';
import { ReplyWriterSettings } from '../../ReplyWriterSettings';
import { ImageGenerationSettings } from '../../ImageGenerationSettings';
import { VideoGenerationSettings } from '../../VideoGenerationSettings';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';
import { AsrModelSettings } from '../asr-model-settings.js';
import {
  WorkspaceHealth,
  WorkspaceSummary,
  WorkspaceTab,
  WorkspaceTabStrip,
} from '../settings-workspace-header.js';
import {
  buildModelWorkspaceSummary,
  type ModelTab,
  type ModelWorkspaceIssue,
} from './models-workspace-summary.js';

export { buildModelWorkspaceSummary };
export type { ModelWorkspaceSummary } from './models-workspace-summary.js';

function issueLabel(issue: ModelWorkspaceIssue, isChinese: boolean): string {
  switch (issue.kind) {
    case 'no-provider':
      return isChinese ? '没有启用的服务商' : 'No provider is enabled';
    case 'no-chat-default':
      return isChinese ? '对话未设置默认模型' : 'No default chat model';
    case 'no-image-default':
      return isChinese ? '图片生成未设置默认模型' : 'No default image model';
    case 'no-video-default':
      return isChinese ? '视频生成未设置默认模型' : 'No default video model';
    case 'speech-default-unavailable':
      return isChinese ? '语音识别的默认模型不可用' : 'Default speech model is unavailable';
  }
}

type CapabilityKind = ModelTab;

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
    loadProviderSecret,
    remoteSettingsReadOnly,
    hostClient,
  } = useSettings();
  const [activeTab, setActiveTab] = useState<ModelTab>('text');
  // Kept here so switching capability tabs does not reset the provider rail.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  if (!config) {
    return (
      <p className="muted" data-testid="settings-models-loading">
        {isChinese ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  const summary = buildModelWorkspaceSummary(config);
  const attentionTabs = new Set(summary.issues.map((issue) => issue.tab));
  const unsetLabel = isChinese ? '未设置默认模型' : 'No default selected';

  return (
    <div className="settings-models-page settings-hub-page settings-workspace-page" data-testid="settings-models">
      <section className="model-management" data-testid="settings-model-management">
        <WorkspaceSummary
          testId="model-workspace-overview"
          readouts={[
            {
              value: `${summary.activeProviderCount}/${summary.providerCount}`,
              label: isChinese ? '服务商已启用' : 'channels on',
            },
            {
              value: `${summary.enabledModelCount}/${summary.modelCount}`,
              label: isChinese ? '模型可用' : 'models available',
            },
            {
              value: `${summary.readyDefaultCount}/${summary.applicableDefaultCount}`,
              label: isChinese ? '能力已设默认' : 'defaults set',
            },
          ]}
          actions={
            <>
              <ModelCatalogSyncControl />
              <WorkspaceHealth
                issues={summary.issues.map((issue) => ({ label: issueLabel(issue, isChinese) }))}
                readyLabel={isChinese ? '配置就绪' : 'Ready'}
                pendingLabel={(count) =>
                  isChinese ? `${count} 项待处理` : `${count} need attention`
                }
                onOpen={() => {
                  const first = summary.issues[0];
                  if (first) setActiveTab(first.tab);
                }}
                testId="model-workspace-health"
              />
            </>
          }
        />

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as ModelTab)}
          className="settings-workspace"
          testId="model-config-tabs"
        >
          <WorkspaceTabStrip label={isChinese ? '模型能力' : 'Model capabilities'}>
            <WorkspaceTab
              value="text"
              icon={<ModelCapabilityIcon kind="text" />}
              title={isChinese ? '服务商与对话' : 'Channels & chat'}
              hint={`${isChinese ? '密钥、端点和对话默认模型' : 'Keys, endpoints, and chat default'} · ${summary.chatDefaultLabel ?? unsetLabel}`}
              count={summary.textModelCount}
              attention={attentionTabs.has('text')}
              testId="model-config-tab-text"
            />
            <WorkspaceTab
              value="vision"
              icon={<ModelCapabilityIcon kind="vision" />}
              title={isChinese ? '视觉委托' : 'Vision'}
              hint={isChinese ? '纯文本模型的多模态图片转写' : 'Multimodal description for text models'}
              tone={config.visionDelegation?.enabled ? 'ok' : 'off'}
              testId="model-config-tab-vision"
            />
            <WorkspaceTab
              value="writer"
              icon={<ModelCapabilityIcon kind="writer" />}
              title={isChinese ? '输出委托' : 'Reply writer'}
              hint={
                isChinese
                  ? '主模型完成任务后由写作模型润色回复表达'
                  : 'Rewrite the visible reply after the worker turn'
              }
              tone={config.replyWriter?.enabled ? 'ok' : 'off'}
              testId="model-config-tab-writer"
            />
            <WorkspaceTab
              value="image"
              icon={<ModelCapabilityIcon kind="image" />}
              title={isChinese ? '图片生成' : 'Images'}
              hint={`${isChinese ? '生图路由、模型和调用测试' : 'Routes, models, and call tests'} · ${summary.imageDefaultLabel ?? unsetLabel}`}
              count={summary.imageModelCount}
              attention={attentionTabs.has('image')}
              testId="model-config-tab-image"
            />
            <WorkspaceTab
              value="video"
              icon={<ModelCapabilityIcon kind="video" />}
              title={isChinese ? '视频生成' : 'Video'}
              hint={`${isChinese ? '异步任务接口和默认模型' : 'Async APIs and video default'} · ${summary.videoDefaultLabel ?? unsetLabel}`}
              count={summary.videoModelCount}
              attention={attentionTabs.has('video')}
              testId="model-config-tab-video"
            />
            <WorkspaceTab
              value="speech"
              icon={<ModelCapabilityIcon kind="speech" />}
              title={isChinese ? '语音能力' : 'Speech'}
              hint={isChinese ? 'piwin Live 实时语音' : 'piwin Live realtime voice'}
              count={summary.speechModelCount}
              attention={attentionTabs.has('speech')}
              testId="model-config-tab-speech"
            />
          </WorkspaceTabStrip>

          <TabsContent
            value="text"
            className="model-management-tab-content settings-workspace-panel"
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
                onLoadSecret={loadProviderSecret}
                selectedProviderId={selectedProviderId}
                onSelectProvider={setSelectedProviderId}
                searchCatalog={async (query) => {
                  const result = await searchModelCatalog({ query, limit: 12 });
                  return result.entries;
                }}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="vision"
            className="model-management-tab-content settings-workspace-panel"
            testId="model-config-panel-vision"
          >
            <div className="settings-section settings-section-card" data-testid="settings-vision-page">
              <VisionDelegationSettings />
            </div>
          </TabsContent>

          <TabsContent
            value="writer"
            className="model-management-tab-content settings-workspace-panel"
            testId="model-config-panel-writer"
          >
            <div className="settings-section settings-section-card" data-testid="settings-reply-writer-page">
              <ReplyWriterSettings />
            </div>
          </TabsContent>

          <TabsContent
            value="image"
            className="model-management-tab-content settings-workspace-panel"
            testId="model-config-panel-image"
          >
            <ImageGenerationSettings />
          </TabsContent>

          <TabsContent
            value="video"
            className="model-management-tab-content settings-workspace-panel"
            testId="model-config-panel-video"
          >
            <VideoGenerationSettings />
          </TabsContent>

          <TabsContent
            value="speech"
            className="model-management-tab-content settings-workspace-panel"
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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65">
      {paths[props.kind]}
    </svg>
  );
}
