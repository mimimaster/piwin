import type { ReactElement } from 'react';
import type { HealthForegroundUseMode } from '../client-tools/client-tool-preferences.js';

export type HealthSettingsPanelProps = {
  available: boolean;
  hostLabel: string;
  useMode: HealthForegroundUseMode;
  onChangeUseMode: (mode: HealthForegroundUseMode) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  lastReadLabel?: string;
  backgroundAvailable?: boolean;
};

export function HealthSettingsPanel({
  available,
  hostLabel,
  useMode,
  onChangeUseMode,
  onConnect,
  onDisconnect,
  lastReadLabel,
  backgroundAvailable = false,
}: HealthSettingsPanelProps): ReactElement {
  if (!available) {
    return (
      <section className="health-settings" data-testid="health-settings">
        <h2>Apple Health</h2>
        <p>当前设备或 Host 不支持本机健康能力。</p>
      </section>
    );
  }

  return (
    <section className="health-settings" data-testid="health-settings">
      <h2>本机能力 · Apple Health</h2>
      <p>连接后，Piwin 可在你明确同意时读取所选分类的摘要并发送到 {hostLabel}。</p>
      <p>连接不等于后台上传，也不等于持续联网。</p>
      <button type="button" onClick={onConnect}>
        连接 Apple Health
      </button>
      <label>
        前台使用方式
        <select
          value={useMode}
          onChange={(event) => onChangeUseMode(event.target.value as HealthForegroundUseMode)}
        >
          <option value="off">关闭</option>
          <option value="ask-every-time">每次询问</option>
          <option value="allow-for-session">允许当前会话</option>
          <option value="always-allow-this-host">始终允许此 Host</option>
        </select>
      </label>
      {lastReadLabel ? <p>最近一次读取：{lastReadLabel}</p> : null}
      <label>
        <input type="checkbox" disabled checked={false} />
        后台摘要同步{backgroundAvailable ? '' : '（尚不可用）'}
      </label>
      <button type="button" onClick={onDisconnect}>
        断开 Piwin 的 Health 访问
      </button>
      <p>断开不会修改 Apple 健康数据，也不会删除已有聊天里的摘要。</p>
    </section>
  );
}
