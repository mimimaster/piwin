/**
 * ADR 0101 remote-access settings copy (relay, relay user, legacy clients).
 * Kept apart from the phone-access copy so each file stays small.
 */
import type { ChannelFailureKind } from '@piwin/host-client';
import type { DesktopLocale } from './desktop-locale.js';

export type RemoteAccessCopy = {
  sectionTitle: string;
  sectionDescription: string;
  relayLabel: string;
  relayDescription: string;
  relayUrlLabel: string;
  relayUrlPlaceholder: string;
  enrollTokenLabel: string;
  enrollTokenHint: string;
  save: string;
  relayState: Record<'off' | 'connecting' | 'ready' | 'error', string>;
  relayCloseHint: (code: number) => string;
  userLabel: string;
  userDescription: (userId: string) => string;
  rename: string;
  copyEnrollmentLine: string;
  copied: string;
  legacyLabel: string;
  legacyDescription: string;
  legacyModes: Record<'full' | 'migrate-only' | 'off', string>;
  operatorCode: string;
  operatorCodeHint: string;
  deviceOperator: string;
  deviceLegacy: string;
  deviceMigrated: string;
  pairLinkLabel: string;
  pairLinkPlaceholder: string;
  pairWithLink: string;
  pairing: string;
  pairedHostsLabel: string;
  pairedHostMeta: (input: { userName: string; relay: boolean; operator: boolean }) => string;
  connectHost: string;
  forgetHost: string;
  forgetTitle: (hostName: string) => string;
  forgetDescription: string;
  cancel: string;
  secretsMissing: string;
  channelFailures: Record<ChannelFailureKind, string>;
};

const CLOSE_HINTS_ZH: Record<number, string> = {
  4401: '中转还没登记这个用户：在中转上添加登记行，或填写登记口令。',
  4403: '中转停用了这个用户或拒绝了这台电脑。',
  4429: '已超过中转为这个用户设定的上限。',
  4409: '另一个进程正以同一身份连接中转。',
};
const CLOSE_HINTS_EN: Record<number, string> = {
  4401: 'The relay has not registered this user: add the enrollment line on the relay, or set an enroll token.',
  4403: 'The relay disabled this user or denied this computer.',
  4429: "This user is over the relay's limits.",
  4409: 'Another process is connected to the relay with the same identity.',
};

export const REMOTE_ACCESS_COPY: Record<DesktopLocale, RemoteAccessCopy> = {
  'zh-CN': {
    sectionTitle: '远程访问',
    sectionDescription:
      '通过你自建的中转，手机、其他电脑和终端在任何网络下都能连上这台电脑，全程端到端加密。',
    relayLabel: '使用中转',
    relayDescription: '开启后，已配对的设备优先经中转连接；连不上中转时再走局域网直连。',
    relayUrlLabel: '中转地址',
    relayUrlPlaceholder: 'wss://relay.example.com',
    enrollTokenLabel: '登记口令（可选）',
    enrollTokenHint: '中转设置了 PIWIN_RELAY_ENROLL_TOKEN 时填写，首次连接后自动清除。',
    save: '保存',
    relayState: { off: '未开启', connecting: '连接中', ready: '已连接', error: '连接失败' },
    relayCloseHint: (code) => CLOSE_HINTS_ZH[code] ?? `中转断开了连接（${code}）。`,
    userLabel: '中转用户',
    userDescription: (userId) => `中转靠这个用户识别你的电脑（${userId}）。`,
    rename: '改名',
    copyEnrollmentLine: '复制登记行',
    copied: '已复制',
    legacyLabel: '旧版客户端',
    legacyDescription: '还没升级的手机和终端走旧的明文连接。迁移完成后可以只允许迁移，或完全关闭。',
    legacyModes: {
      full: '照常使用',
      'migrate-only': '只允许迁移',
      off: '关闭',
    },
    operatorCode: '生成管理员配对码',
    operatorCodeHint: '用这个二维码配对的设备拥有管理权限（配对、中转设置）。',
    deviceOperator: '管理员',
    deviceLegacy: '旧版连接',
    deviceMigrated: '已迁移',
    pairLinkLabel: '配对链接',
    pairLinkPlaceholder: 'piwin://pair?v=3…',
    pairWithLink: '用链接配对',
    pairing: '正在配对…',
    pairedHostsLabel: '已配对的 Host',
    pairedHostMeta: ({ userName, relay, operator }) =>
      [userName, relay ? '中转' : '直连', ...(operator ? ['管理员'] : [])].join(' · '),
    connectHost: '连接',
    forgetHost: '移除',
    forgetTitle: (hostName) => `移除 ${hostName}？`,
    forgetDescription: '这台设备会删除与它的配对密钥。之后要再连接，需要在 Host 上生成新的配对码。',
    cancel: '取消',
    secretsMissing: '这台设备上找不到它的配对密钥，请重新配对。',
    channelFailures: {
      'host-unavailable': 'Host 不在线，或不在这个中转上。请确认电脑开着并已连上中转。',
      'host-key-mismatch': 'Host 的身份和配对时不一致，请在 Host 上生成新的配对码重新配对。',
      'relay-limited': '中转暂时不接受更多连接，请稍后再试。',
      'relay-forbidden': '中转拒绝了这个连接，请检查中转地址或用户是否被停用。',
    },
  },
  en: {
    sectionTitle: 'Remote access',
    sectionDescription:
      'Through a relay you run, phones, other computers and terminals reach this computer from any network, end-to-end encrypted.',
    relayLabel: 'Use a relay',
    relayDescription:
      'Paired devices connect through the relay first and fall back to the local network.',
    relayUrlLabel: 'Relay address',
    relayUrlPlaceholder: 'wss://relay.example.com',
    enrollTokenLabel: 'Enroll token (optional)',
    enrollTokenHint:
      'Needed when the relay sets PIWIN_RELAY_ENROLL_TOKEN; cleared after the first connection.',
    save: 'Save',
    relayState: { off: 'Off', connecting: 'Connecting', ready: 'Connected', error: 'Failed' },
    relayCloseHint: (code) => CLOSE_HINTS_EN[code] ?? `The relay closed the connection (${code}).`,
    userLabel: 'Relay user',
    userDescription: (userId) => `The relay knows your computers by this user (${userId}).`,
    rename: 'Rename',
    copyEnrollmentLine: 'Copy enrollment line',
    copied: 'Copied',
    legacyLabel: 'Older clients',
    legacyDescription:
      'Phones and terminals that have not updated use the old cleartext connection. Once they migrated, allow migration only, or turn it off.',
    legacyModes: { full: 'Allowed', 'migrate-only': 'Migration only', off: 'Off' },
    operatorCode: 'Generate an admin pairing code',
    operatorCodeHint: 'A device paired with this code can manage pairing and relay settings.',
    deviceOperator: 'admin',
    deviceLegacy: 'older connection',
    deviceMigrated: 'migrated',
    pairLinkLabel: 'Pairing link',
    pairLinkPlaceholder: 'piwin://pair?v=3…',
    pairWithLink: 'Pair with link',
    pairing: 'Pairing…',
    pairedHostsLabel: 'Paired Hosts',
    pairedHostMeta: ({ userName, relay, operator }) =>
      [userName, relay ? 'relay' : 'direct', ...(operator ? ['admin'] : [])].join(' · '),
    connectHost: 'Connect',
    forgetHost: 'Remove',
    forgetTitle: (hostName) => `Remove ${hostName}?`,
    forgetDescription:
      'This device deletes its pairing keys for this Host. Connecting again needs a new pairing code from the Host.',
    cancel: 'Cancel',
    secretsMissing: 'This device no longer has the pairing keys for this Host; pair it again.',
    channelFailures: {
      'host-unavailable':
        'The Host is offline or not on this relay. Check that the computer is on and connected to the relay.',
      'host-key-mismatch':
        'The Host identity does not match the one you paired with. Pair again with a new code from the Host.',
      'relay-limited': 'The relay is not taking more connections right now; try again shortly.',
      'relay-forbidden':
        'The relay refused this connection. Check the relay address, or whether the user is disabled.',
    },
  },
};

export function getRemoteAccessCopy(locale: string): RemoteAccessCopy {
  return locale === 'en' ? REMOTE_ACCESS_COPY.en : REMOTE_ACCESS_COPY['zh-CN'];
}
