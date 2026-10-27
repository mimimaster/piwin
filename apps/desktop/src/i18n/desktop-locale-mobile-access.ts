/**
 * Phone-access settings copy. Split out of `desktop-locale.ts` (over the file
 * cap) so this feature's strings live next to each other in both languages.
 */
import type { DesktopLocale } from './desktop-locale.js';

export type MobileAccessCopy = {
  title: string;
  description: string;
  listenLabel: string;
  qrTitle: string;
  qrHint: string;
  /** Pairing over the relay: the phone can be on any network. */
  qrHintRelay: string;
  qrLabel: string;
  pairingExpires: (at: string) => string;
  generate: string;
  generating: string;
  uriLabel: string;
  copyUri: string;
  copied: string;
  advertisedLabel: string;
  advertisedHint: string;
  addressAuto: (url: string) => string;
  addressAutoNone: string;
  addressCustom: string;
  addressKindLan: string;
  addressKindTailscale: string;
  advertisedPlaceholder: string;
  apply: string;
  invalidAdvertised: string;
  noNetworkAddress: string;
  startFailed: (message: string) => string;
  securityHint: string;
  devices: string;
  revoke: string;
  revokedSuffix: string;
  lastSeen: (at: string) => string;
  switchToLocal: string;
  hostPairingUnsupportedTitle: string;
  hostPairingUnsupportedDesc: string;
  statusUnsupported: string;
  readOnlyHint: string;
};

export const MOBILE_ACCESS_COPY: Record<DesktopLocale, MobileAccessCopy> = {
  'zh-CN': {
    title: '手机接入',
    description: '用手机扫码连接这台电脑上的 Host，随时查看和操作会话。',
    listenLabel: '允许手机接入',
    qrTitle: '用手机扫码连接',
    qrHint: '打开 Piwin 手机 App，选择「扫码连接」。手机需要和这台电脑在同一 Wi‑Fi，或同一 Tailscale 网络。',
    qrHintRelay: '打开 Piwin 手机 App，选择「扫码连接」。已开启中转，手机在任何网络下都能连上。',
    qrLabel: '手机配对二维码',
    pairingExpires: (at) => `二维码有效至 ${at}，只能使用一次`,
    generate: '刷新二维码',
    generating: '正在生成…',
    uriLabel: '无法扫码时，可复制配对链接',
    copyUri: '复制链接',
    copied: '已复制',
    advertisedLabel: '手机连接地址',
    advertisedHint: '写进二维码的地址。默认自动使用本机局域网 IP。',
    addressAuto: (url) => `自动（${url}）`,
    addressAutoNone: '自动（未检测到局域网地址）',
    addressCustom: '自定义…',
    addressKindLan: '局域网',
    addressKindTailscale: 'Tailscale',
    advertisedPlaceholder: 'ws://192.168.1.10:8790 或 wss://mac.tailnet.ts.net',
    apply: '应用',
    invalidAdvertised: '请输入 ws:// 或 wss:// 开头的地址',
    noNetworkAddress: '没有检测到局域网地址。请先连接 Wi‑Fi，或在「手机连接地址」里选择自定义。',
    startFailed: (message) => `手机接入没有启动：${message}`,
    securityHint: '局域网连接不加密（ws://），请只在自己信任的网络里使用；出门在外建议用 Tailscale。',
    devices: '已配对设备',
    revoke: '撤销',
    revokedSuffix: ' · 已撤销',
    lastSeen: (at) => `最后活跃：${at}`,
    switchToLocal: '切换至本机 Host',
    hostPairingUnsupportedTitle: 'Host 不支持远程配对',
    hostPairingUnsupportedDesc: '当前连接的 Host 版本较低，未提供配对管理接口。请更新 Host 服务端。',
    statusUnsupported: '不支持',
    readOnlyHint: '当前以配对设备身份连接，无权管理配对凭证或设备。',
  },
  en: {
    title: 'Phone access',
    description: 'Scan a QR code with your phone to reach the Host on this computer.',
    listenLabel: 'Allow phone access',
    qrTitle: 'Scan with your phone',
    qrHint:
      'Open the Piwin phone app and choose “Scan to connect”. The phone must be on the same Wi‑Fi as this computer, or the same Tailscale network.',
    qrHintRelay:
      'Open the Piwin phone app and choose “Scan to connect”. The relay is on, so the phone can connect from any network.',
    qrLabel: 'Phone pairing QR code',
    pairingExpires: (at) => `Valid until ${at}, single use`,
    generate: 'Refresh QR code',
    generating: 'Creating…',
    uriLabel: 'Can’t scan? Copy the pairing link instead',
    copyUri: 'Copy link',
    copied: 'Copied',
    advertisedLabel: 'Phone address',
    advertisedHint: 'The address written into the QR code. Defaults to this computer’s LAN IP.',
    addressAuto: (url) => `Automatic (${url})`,
    addressAutoNone: 'Automatic (no LAN address found)',
    addressCustom: 'Custom…',
    addressKindLan: 'LAN',
    addressKindTailscale: 'Tailscale',
    advertisedPlaceholder: 'ws://192.168.1.10:8790 or wss://mac.tailnet.ts.net',
    apply: 'Apply',
    invalidAdvertised: 'Enter a URL starting with ws:// or wss://',
    noNetworkAddress: 'No LAN address found. Join a Wi‑Fi network, or pick Custom under Phone address.',
    startFailed: (message) => `Phone access did not start: ${message}`,
    securityHint:
      'LAN connections are not encrypted (ws://). Use them only on networks you trust; use Tailscale when away.',
    devices: 'Paired devices',
    revoke: 'Revoke',
    revokedSuffix: ' · revoked',
    lastSeen: (at) => `Last seen: ${at}`,
    switchToLocal: 'Switch to this Mac’s Host',
    hostPairingUnsupportedTitle: 'Host pairing not supported',
    hostPairingUnsupportedDesc:
      'The connected Host is too old to manage pairing. Please update the Host service.',
    statusUnsupported: 'Unsupported',
    readOnlyHint: 'Connected as a paired device. Managing pairing credentials or devices is not permitted.',
  },
};
