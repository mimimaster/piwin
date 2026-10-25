/**
 * ADR 0101 remote-access settings copy (relay, relay user, legacy clients).
 * Kept apart from the phone-access copy so each file stays small.
 */
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
  },
};

export function getRemoteAccessCopy(locale: string): RemoteAccessCopy {
  return locale === 'en' ? REMOTE_ACCESS_COPY.en : REMOTE_ACCESS_COPY['zh-CN'];
}
