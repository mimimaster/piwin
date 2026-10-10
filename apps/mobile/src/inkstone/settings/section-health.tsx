import { useState, type ReactElement } from 'react';
import type { HealthForegroundUseMode } from '@piwin/host-client';
import type { InkstoneHost } from '../host/inkstone-host-context.js';
import { FullButton, RadioOptions, SectionLabel } from '../inkstone-ui.js';
import { endpointLabel } from '../pages/sessions.js';

const MODE_LABELS: [HealthForegroundUseMode, string][] = [
  ['ask-every-time', '每次询问'],
  ['allow-for-session', '当前会话内不再问'],
  ['always-allow-this-host', '始终允许这台 Host'],
  ['off', '关闭'],
];

/** The Host's default chat model, named in the sharing disclosure when known. */
function defaultModelLabel(host: InkstoneHost): string | undefined {
  const model = host.configuredModels.find(
    (item) => item.providerId === host.defaultProviderId && item.modelId === host.defaultModelId,
  );
  return model === undefined
    ? undefined
    : `${model.providerName ?? model.providerId} · ${model.label ?? model.modelId}`;
}

/**
 * Shown before Connect: health summaries leave the phone for the user's Host
 * and, from there, a third-party AI model (App Review 5.1.2(i)). Nothing is
 * connected unless the user taps Allow.
 */
function HealthSharingConsent({
  host,
  onDecide,
}: {
  host: InkstoneHost;
  onDecide: (allow: boolean) => void;
}): ReactElement {
  return (
    <div data-testid="health-sharing-consent">
      <SectionLabel>允许把健康数据发送给 AI 模型？</SectionLabel>
      <dl className="facts">
        <dt>数据</dt>
        <dd>
          步数、活动能量、锻炼分钟数、日照时间、静息心率、心率变异性、体重、体脂率、最大摄氧量、呼吸频率、血氧、手腕温度、体能训练、睡眠和正念分钟数的汇总；只读取你在
          Apple 健康授权页里允许的类别
        </dd>
        <dt>发送到</dt>
        <dd>
          你自己的 Piwin Host（{endpointLabel(host.endpoint)}），再由 Host 交给你在 Host
          上配置的第三方 AI 模型服务商（{defaultModelLabel(host) ?? '你选择的模型服务商'}）
        </dd>
        <dt>用途</dt>
        <dd>只用于生成你要求的健康摘要、回答你的健康问题</dd>
      </dl>
      <p className="quote-note">
        不会用于广告，也不会出售，Piwin 开发者不会收到这些数据。你可以选择「不允许」，其他功能照常使用；连接后也能随时在这里改为「关闭」或断开来撤回同意。
      </p>
      <FullButton onClick={() => onDecide(true)}>允许并连接</FullButton>
      <FullButton variant="subtle" onClick={() => onDecide(false)}>
        不允许
      </FullButton>
    </div>
  );
}

/**
 * Apple Health is a device capability, not a Host setting: the phone reads
 * HealthKit and sends bounded summaries only when the Host asks and the user
 * agrees. Connecting advertises the client tool on the next hello.
 */
export function HealthSection({ host }: { host: InkstoneHost }): ReactElement {
  const [confirming, setConfirming] = useState(false);
  if (!host.healthAvailable) {
    return (
      <p className="quote-note">
        {host.connectionState.kind !== 'ready'
          ? '连上 Host 后才能判断是否可用。'
          : '暂不可用：需要 iPhone 真机，且 Host 为支持设备工具的版本。'}
      </p>
    );
  }
  if (!host.healthConnected) {
    if (confirming) {
      return (
        <HealthSharingConsent
          host={host}
          onDecide={(allow) => {
            setConfirming(false);
            if (allow) void host.handleConnectAppleHealth();
          }}
        />
      );
    }
    return (
      <>
        <p className="quote-note">
          连接后，模型可以在你同意时读取步数、睡眠、心率等摘要来回答问题。只在前台读取，不做后台上传。
        </p>
        <FullButton onClick={() => setConfirming(true)}>连接 Apple Health</FullButton>
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
