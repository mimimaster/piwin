import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { FullButton, ListRow, ScreenHeading, TopBar } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { useHostSettings } from './use-host-settings.js';
import { AgentPolicySection, PermissionsSection, SessionRuntimeSection } from './section-runtime.js';
import { AuthSection, ModelsSection } from './section-models.js';
import { HooksSection, SkillsMcpSection, WebSection } from './section-capabilities.js';
import { ArchiveSection, ColdStorageSection, UsageSection } from './section-storage.js';

/**
 * One settings section, fully backed by Host commands. Anything the phone
 * cannot do safely (credentials, installs, moving Host files) is stated as a
 * desktop action instead of rendered as a dead placeholder.
 */
export function HostSettingsDetail({
  hostCtx,
  section,
}: {
  hostCtx: InkstoneHostContextValue;
  section: string;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const settings = useHostSettings(client);
  const toast = (message: string): void => dispatch({ type: 'toast', message });

  const body = ((): ReactElement => {
    switch (section) {
      case '通用与外观':
        return (
          <>
            <ListRow name="globe" title="私有 Host" subtitle={host.endpoint} onClick={hostCtx.onOpenConnection} />
            <ListRow name="panel" title="纸 / 墨外观" subtitle="只影响这台设备" onClick={() => dispatch({ type: 'toggle-face' })} />
            <p className="quote-note">外观是本机偏好；会话、模型与工具以 Host 为准。</p>
          </>
        );
      case '权限与安全':
        return <PermissionsSection settings={settings} client={client} onToast={toast} />;
      case '模型配置':
        return <ModelsSection settings={settings} models={host.configuredModels} onToast={toast} />;
      case 'OAuth 登录':
        return <AuthSection client={client} />;
      case 'Hooks':
        return <HooksSection settings={settings} client={client} onToast={toast} />;
      case '智能体策略':
        return <AgentPolicySection settings={settings} />;
      case '技能与扩展':
        return <SkillsMcpSection settings={settings} client={client} onToast={toast} />;
      case '网络搜索与抓取':
        return <WebSection settings={settings} onToast={toast} />;
      case '知识库与向量':
        return (
          <>
            <ListRow
              name="book"
              title="知识库"
              subtitle={`${host.knowledgeBases.length} 个 Host 信源`}
              onClick={() => dispatch({ type: 'navigate', route: 'knowledge' })}
            />
            <p className="quote-note">索引、嵌入、重排和解析都在 Host 执行，手机请求并展示结果。</p>
          </>
        );
      case '会话与运行时':
        return (
          <SessionRuntimeSection
            settings={settings}
            onToast={toast}
            onOpenSessions={() => dispatch({ type: 'navigate', route: 'sessions' })}
          />
        );
      case '冷存储':
        return <ColdStorageSection client={client} />;
      case '用量统计':
        return <UsageSection client={client} />;
      case '归档管理':
        return <ArchiveSection client={client} onToast={toast} />;
      default:
        return (
          <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'desk' })}>
            返回案头
          </FullButton>
        );
    }
  })();

  return (
    <>
      <TopBar title={section} subtitle="设置 · Host" onBack={() => dispatch({ type: 'navigate', route: 'desk' })} />
      <div className="screen-scroll">
        <ScreenHeading title={section} />
        {settings.error !== undefined ? <p className="error-text">{settings.error}</p> : null}
        {body}
      </div>
    </>
  );
}
