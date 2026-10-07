import type { HealthForegroundUseMode } from '@piwin/host-client';
import type { DesktopLocale } from './desktop-locale-id.js';

type DeviceHealthCopy = {
  title: string;
  description: string;
  notConnected: string;
  unavailable: string;
  unavailableReasons: Record<
    'detached' | 'no-healthkit' | 'host-unsupported' | 'unpaired' | 'failed',
    string
  >;
  connected: string;
  connect: string;
  connecting: string;
  disconnect: string;
  disconnectNote: string;
  useModeLabel: string;
  useModes: Record<HealthForegroundUseMode, string>;
  attachToTurn: string;
  connectFailed: string;
  consentTitle: string;
  consentDestination: (destination: string) => string;
  consentLocal: string;
  consentExternal: string;
  consentReadOnly: string;
  allowOnce: string;
  allowSession: string;
  allowAlways: string;
  deny: string;
  backgroundSyncLabel: string;
  backgroundSyncDescription: string;
  backgroundSyncHostOff: string;
  backgroundSyncNever: string;
  backgroundSyncLast: (when: string) => string;
  backgroundSyncFailed: (code: string) => string;
  backgroundSyncToggleFailed: string;
};

export const DEVICE_HEALTH_COPY: Record<DesktopLocale, DeviceHealthCopy> = {
  'zh-CN': {
    title: 'Apple Health',
    description:
      '连接后，Piwin 可在你明确同意时读取所选分类的摘要并发送给当前 Host。连接不等于后台上传。',
    notConnected: '未连接',
    unavailable: '不可用',
    unavailableReasons: {
      detached: '正在连接 Host…',
      'no-healthkit': '这台设备读不到 Apple Health。需要 iPhone 真机，模拟器和 iPad 不支持。',
      'host-unsupported': '当前 Host 版本不支持设备工具，请把 Host 升级到最新版。',
      unpaired: '这台设备还没有和 Host 配对。Host 只接受已配对设备提供的数据，请先扫码配对。',
      failed: 'Apple Health 初始化失败，请重启 App 再试。',
    },
    connected: '已连接',
    connect: '连接 Apple Health',
    connecting: '正在连接…',
    disconnect: '断开',
    disconnectNote: '断开不会修改 Apple 健康数据，也不会删除已有聊天里的摘要。',
    useModeLabel: '读取前',
    useModes: {
      off: '关闭',
      'ask-every-time': '每次询问',
      'allow-for-session': '允许当前会话',
      'always-allow-this-host': '始终允许此 Host',
    },
    attachToTurn: '附带 Apple Health',
    connectFailed: 'Apple Health 授权失败。',
    consentTitle: 'Piwin 想为这个问题读取 Apple Health',
    consentDestination: (destination) => `发送到：${destination}`,
    consentLocal: '本地',
    consentExternal: '外部',
    consentReadOnly: 'Piwin 只读，不会向 Apple Health 写入任何内容。',
    allowOnce: '允许一次',
    allowSession: '允许本次会话',
    allowAlways: '始终允许此 Host',
    deny: '拒绝',
    backgroundSyncLabel: '后台同步',
    backgroundSyncDescription:
      '允许 iPhone 在后台把每日健康摘要上传到这台 Host 并保存在那里。手机离线时也能回答健康问题，还能生成定时摘要。关闭会同时删除这台设备已上传的摘要。',
    backgroundSyncHostOff:
      'Host 尚未开启「保存健康摘要」。请先在下方「健康摘要存储」里打开。',
    backgroundSyncNever: '还没有同步过。',
    backgroundSyncLast: (when) => `最近同步：${when}`,
    backgroundSyncFailed: (code) => `上次同步失败（${code}），下次健康数据更新或打开 App 时会重试。`,
    backgroundSyncToggleFailed: '后台同步设置失败。',
  },
  en: {
    title: 'Apple Health',
    description:
      'Once connected, Piwin can read a summary of the categories you choose and send it to the current Host, only when you agree. Connecting does not upload anything in the background.',
    notConnected: 'Not connected',
    unavailable: 'Unavailable',
    unavailableReasons: {
      detached: 'Connecting to the Host…',
      'no-healthkit':
        'Apple Health cannot be read on this device. It needs a real iPhone; the Simulator and iPad are not supported.',
      'host-unsupported': 'This Host is too old for device tools. Update the Host.',
      unpaired:
        'This device is not paired with the Host. The Host only accepts data from paired devices; scan a pairing code first.',
      failed: 'Apple Health failed to start. Restart the app and try again.',
    },
    connected: 'Connected',
    connect: 'Connect Apple Health',
    connecting: 'Connecting…',
    disconnect: 'Disconnect',
    disconnectNote:
      'Disconnecting does not change your Apple Health data or remove summaries already in a chat.',
    useModeLabel: 'Before reading',
    useModes: {
      off: 'Off',
      'ask-every-time': 'Ask every time',
      'allow-for-session': 'Allow for this session',
      'always-allow-this-host': 'Always allow this Host',
    },
    attachToTurn: 'Include Apple Health',
    connectFailed: 'Apple Health authorization failed.',
    consentTitle: 'Piwin wants to read Apple Health for this question',
    consentDestination: (destination) => `Sent to: ${destination}`,
    consentLocal: 'local',
    consentExternal: 'external',
    consentReadOnly: 'Piwin only reads. Nothing is written to Apple Health.',
    allowOnce: 'Allow once',
    allowSession: 'Allow for this session',
    allowAlways: 'Always allow this Host',
    deny: 'Deny',
    backgroundSyncLabel: 'Background sync',
    backgroundSyncDescription:
      'Let the iPhone upload daily health summaries to this Host in the background, where they are stored. Health questions then work while the phone is offline, and a scheduled digest becomes possible. Turning this off also deletes what this device uploaded.',
    backgroundSyncHostOff:
      'The Host is not keeping health summaries yet. Turn on “Keep health summaries” below first.',
    backgroundSyncNever: 'Not synced yet.',
    backgroundSyncLast: (when) => `Last sync: ${when}`,
    backgroundSyncFailed: (code) =>
      `The last sync failed (${code}). It retries when health data changes or the app opens.`,
    backgroundSyncToggleFailed: 'Background sync could not be changed.',
  },
};
