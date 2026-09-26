import type { ReactElement } from 'react';
import type { HealthForegroundUseMode } from '../../client-tools/client-tool-preferences.js';
import type { InkstoneHost } from '../host/inkstone-host-context.js';
import { FullButton, RadioOptions, SectionLabel } from '../inkstone-ui.js';

const MODE_LABELS: [HealthForegroundUseMode, string][] = [
  ['ask-every-time', '每次询问'],
  ['allow-for-session', '当前会话内不再问'],
  ['always-allow-this-host', '始终允许这台 Host'],
  ['off', '关闭'],
];

/**
 * Apple Health is a device capability, not a Host setting: the phone reads
 * HealthKit and sends bounded summaries only when the Host asks and the user
 * agrees. Connecting advertises the client tool on the next hello.
 */
export function HealthSection({ host }: { host: InkstoneHost }): ReactElement {
  if (!host.healthAvailable) {
    return (
      <p className="quote-note">
        {host.connectionState.kind !== 'ready'
          ? '连上 Host 后才能判断是否可用。'
          : '暂不可用：需要 iPhone 真机，且 Host 以 PIWIN_EXPERIMENTAL_APPLE_HEALTH=1 启动（实验功能，默认关闭）。'}
      </p>
    );
  }
  if (!host.healthConnected) {
    return (
      <>
        <p className="quote-note">
          连接后，模型可以在你同意时读取步数、睡眠、心率等摘要来回答问题。只在前台读取，不做后台上传。
        </p>
        <FullButton onClick={() => void host.handleConnectAppleHealth()}>连接 Apple Health</FullButton>
      </>
    );
  }
  const visibleModes = MODE_LABELS.filter(
    ([mode]) => mode !== 'always-allow-this-host' || host.healthAlwaysAllowUnlocked || host.healthUseMode === mode,
  );
  const selected = visibleModes.find(([mode]) => mode === host.healthUseMode)?.[1] ?? '每次询问';
  return (
    <>
      <SectionLabel>读取前</SectionLabel>
      <RadioOptions
        values={visibleModes.map(([, label]) => label)}
        selected={selected}
        onSelect={(label) => {
          const mode = visibleModes.find(([, item]) => item === label)?.[0];
          if (mode !== undefined) host.handleChangeHealthUseMode(mode);
        }}
      />
      <p className="quote-note">「始终允许」在你手动允许过一次之后才会出现。</p>
      <FullButton variant="subtle" onClick={() => void host.handleDisconnectAppleHealth()}>
        断开 Apple Health
      </FullButton>
    </>
  );
}
