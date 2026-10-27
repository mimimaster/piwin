/**
 * Copy for the guided Connection & Devices page: step titles, one-line step
 * summaries and the "Advanced" fold. Detailed labels stay with their features
 * (mobile access, remote access, host target).
 */
import type { DesktopLocale } from './desktop-locale.js';

export type ConnectionGuideCopy = {
  optional: string;
  advanced: string;
  // Phone access
  stepAllow: string;
  stepAllowOn: string;
  stepAllowOff: string;
  stepRelay: string;
  stepRelayIdle: string;
  stepRelaySummary: (url: string, state: string) => string;
  relayEdit: string;
  relayCancel: string;
  relaySaveAndOn: string;
  relayNeedsToken: string;
  stepPair: string;
  pairLocalOnly: string;
  // Host target
  hostTitle: string;
  usingLocal: string;
  usingRemote: (endpoint: string) => string;
  usingNone: string;
  connectOther: string;
  stepCopyLink: string;
  stepCopyLinkHint: string;
  stepOpenQrHint: string;
  stepPasteLink: string;
  // Phone: the camera is the way in, the link stays as a fallback.
  stepOpenQr: string;
  stepScan: string;
  orPasteLink: string;
};

export const CONNECTION_GUIDE_COPY: Record<DesktopLocale, ConnectionGuideCopy> = {
  'zh-CN': {
    optional: '可选',
    advanced: '高级选项',
    stepAllow: '允许手机接入',
    stepAllowOn: '已开启，只有配对过的设备能连接',
    stepAllowOff: '开启后，手机才能连接这台电脑',
    stepRelay: '让手机在外面也能连上',
    stepRelayIdle: '手机和电脑不在同一网络时，经你自建的中转连接',
    stepRelaySummary: (url, state) => `${url} · ${state}`,
    relayEdit: '修改',
    relayCancel: '取消',
    relaySaveAndOn: '保存并开启',
    relayNeedsToken: '中转要求登记口令？',
    stepPair: '用手机扫码配对',
    pairLocalOnly: '这台 Host 只对本机开放，手机要连上需先完成上一步。',
    hostTitle: '当前 Host',
    usingLocal: '正在使用本机 Host',
    usingRemote: (endpoint) => `已连接到 ${endpoint}`,
    usingNone: '还没有连接 Host',
    connectOther: '连接其他 Host',
    stepCopyLink: '在要连接的电脑上复制配对链接',
    stepCopyLinkHint: '设置 → 连接与设备 → 手机与远程访问 → 复制链接',
    stepOpenQrHint: '设置 → 连接与设备 → 手机与远程访问。中转地址已包含在二维码里',
    stepPasteLink: '粘贴配对链接',
    stepOpenQr: '在电脑上打开配对二维码',
    stepScan: '扫码连接',
    orPasteLink: '也可以粘贴配对链接',
  },
  en: {
    optional: 'Optional',
    advanced: 'Advanced',
    stepAllow: 'Allow phone access',
    stepAllowOn: 'On. Only paired devices can connect',
    stepAllowOff: 'Turn on to let phones connect to this computer',
    stepRelay: 'Reach it from anywhere',
    stepRelayIdle: 'When the phone is on another network, connect through a relay you run',
    stepRelaySummary: (url, state) => `${url} · ${state}`,
    relayEdit: 'Edit',
    relayCancel: 'Cancel',
    relaySaveAndOn: 'Save and turn on',
    relayNeedsToken: 'Relay needs an enroll token?',
    stepPair: 'Scan to pair',
    pairLocalOnly:
      'This Host only accepts connections from its own machine; finish the previous step first.',
    hostTitle: 'Current Host',
    usingLocal: 'Using this Mac’s Host',
    usingRemote: (endpoint) => `Connected to ${endpoint}`,
    usingNone: 'No Host connected',
    connectOther: 'Connect to another Host',
    stepCopyLink: 'Copy a pairing link on the other computer',
    stepCopyLinkHint: 'Settings → Connection & Devices → Phone & remote access → Copy link',
    stepOpenQrHint:
      'Settings → Connection & Devices → Phone & remote access. The relay address is inside the code',
    stepPasteLink: 'Paste the pairing link',
    stepOpenQr: 'Open the pairing QR code on your computer',
    stepScan: 'Scan to connect',
    orPasteLink: 'Or paste the pairing link',
  },
};

export function getConnectionGuideCopy(locale: string): ConnectionGuideCopy {
  return locale === 'en' ? CONNECTION_GUIDE_COPY.en : CONNECTION_GUIDE_COPY['zh-CN'];
}
