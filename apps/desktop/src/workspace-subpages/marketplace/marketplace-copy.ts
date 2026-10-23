/**
 * Localized labels for marketplace enums. Pure so the mapping is unit-tested
 * once instead of re-spelled in every card.
 */
import type {
  MarketplaceAvailability,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceCategory,
  MarketplaceInstalledItem,
  MarketplaceInventoryMessageCode,
  MarketplaceLocalizedText,
  MarketplaceRequirementStatus,
  MarketplaceVerification,
} from '@piwin/contracts';
import type { DesktopLocale } from '../../i18n/desktop-locale.js';
import type { MarketOperation, MarketplaceToast } from './marketplace-types.js';

type Pair = readonly [en: string, zh: string];

function pick(locale: DesktopLocale | undefined, pair: Pair): string {
  return locale === 'zh-CN' ? pair[1] : pair[0];
}

export function localizedText(
  text: MarketplaceLocalizedText,
  locale: DesktopLocale | undefined,
): string {
  return locale === 'zh-CN' ? text.zhCN : text.en;
}

/** Display name in the viewer's language; catalog names are bilingual. */
export function entryName(
  entry: Pick<MarketplaceCatalogEntry, 'name'>,
  locale: DesktopLocale | undefined,
): string {
  return localizedText(entry.name, locale) || entry.name.en;
}

const KIND_LABELS: Record<MarketplaceCapabilityKind | 'piwin-extension', Pair> = {
  extension: ['Extension', '扩展'],
  'piwin-extension': ['piwin extensions', 'piwin 扩展'],
  skill: ['Skill', '技能'],
  mcp: ['MCP server', 'MCP 服务'],
  agent: ['Agent', 'Agent'],
};

export function kindLabel(
  kind: MarketplaceCapabilityKind | 'piwin-extension',
  locale: DesktopLocale | undefined,
): string {
  return pick(locale, KIND_LABELS[kind]);
}

const CATEGORY_LABELS: Record<MarketplaceCategory, Pair> = {
  'code-development': ['Code development', '代码开发'],
  'design-content': ['Design & content', '设计与内容'],
  'docs-research': ['Docs & research', '文档与研究'],
  'external-service': ['External services', '外部服务'],
};

export function categoryLabel(
  category: MarketplaceCategory,
  locale: DesktopLocale | undefined,
): string {
  return pick(locale, CATEGORY_LABELS[category]);
}

const AVAILABILITY_LABELS: Record<MarketplaceAvailability, Pair> = {
  installed: ['Installed', '已安装'],
  'configuration-required': ['Needs configuration', '待配置'],
  'pending-apply': ['Pending apply', '待应用'],
  available: ['Available now', '当前可用'],
  disabled: ['Disabled', '已停用'],
  failed: ['Failed', '失败'],
  'pending-removal': ['Removing', '移除中'],
};

export function availabilityLabel(
  availability: MarketplaceAvailability,
  locale: DesktopLocale | undefined,
): string {
  return pick(locale, AVAILABILITY_LABELS[availability]);
}

const OPERATION_LABELS: Record<MarketOperation, Pair> = {
  installing: ['Installing…', '安装中…'],
  updating: ['Updating…', '更新中…'],
  enabling: ['Enabling…', '启用中…'],
  applying: ['Applying to session…', '同步到会话…'],
  starting: ['Connecting…', '连接中…'],
  removing: ['Removing…', '移除中…'],
  toggling: ['Updating…', '更新中…'],
};

/** Toast for `skills/update`: new commit, or "already latest". */
export function describeSkillSourceUpdate(
  name: string,
  data: { changed: boolean; commit?: string },
  locale: DesktopLocale | undefined,
): MarketplaceToast {
  const short = data.commit ? data.commit.slice(0, 7) : undefined;
  if (!data.changed) {
    return {
      type: 'success',
      title: pick(locale, [`[${name}] is up to date`, `[${name}] 已是最新`]),
      text: '',
    };
  }
  return {
    type: 'success',
    title: pick(locale, [`[${name}] updated`, `[${name}] 已更新`]),
    text: short
      ? pick(locale, [
          `Now at ${short}; usable from your next message.`,
          `已更新到 ${short}，下一条消息起生效。`,
        ])
      : pick(locale, ['Usable from your next message.', '下一条消息起生效。']),
  };
}

export function operationLabel(
  operation: MarketOperation,
  locale: DesktopLocale | undefined,
): string {
  return pick(locale, OPERATION_LABELS[operation]);
}

/**
 * Localized Host status line. Unknown codes fall back to the Host's English
 * `message`, so a newer Host never renders blank.
 */
export function inventoryMessage(
  item: Pick<MarketplaceInstalledItem, 'message' | 'messageCode' | 'messageDetail'>,
  locale: DesktopLocale | undefined,
): string | undefined {
  const detail = item.messageDetail;
  const code: MarketplaceInventoryMessageCode | undefined = item.messageCode;
  switch (code) {
    case 'pending-removal':
      return pick(locale, [
        'Removal finishes once no live session still loads it.',
        '没有会话再加载它后完成移除。',
      ]);
    case 'incompatible':
      return pick(locale, [
        'Not compatible with the piwin Agent Runtime; it will not load.',
        '与 piwin Agent Runtime 不兼容，不会加载。',
      ]);
    case 'conversation-only':
      return pick(locale, [
        'Chat conversations do not load extensions; project sessions do.',
        '普通对话不加载扩展，项目会话会加载。',
      ]);
    case 'apply-failed':
      return detail
        ? pick(locale, [
            `Could not apply to this session: ${detail}`,
            `未能应用到当前会话：${detail}`,
          ])
        : pick(locale, ['Could not apply to this session.', '未能应用到当前会话。']);
    case 'pending-apply':
      return pick(locale, ['Applies at the next run boundary.', '下一轮运行开始时生效。']);
    case 'mcp-missing-env':
      return pick(locale, [`Missing value for ${detail ?? ''}`, `缺少配置值：${detail ?? ''}`]);
    case 'mcp-start-failed':
      return detail
        ? pick(locale, [`Failed to start: ${detail}`, `启动失败：${detail}`])
        : pick(locale, ['Server failed to start.', '服务启动失败。']);
    case 'mcp-idle':
      return pick(locale, [
        'Configured; starts when a session needs it.',
        '已配置，会话需要时启动。',
      ]);
    case 'agent-adapter-installed':
      return pick(locale, [
        'Adapter installed; CLI dependency and login are checked separately in Agent Backends.',
        '适配插件已安装；CLI 依赖与登录在 Agent 后端设置中单独检查。',
      ]);
    case undefined:
      return item.message;
  }
}

const REQUIREMENT_STATUS_LABELS: Record<MarketplaceRequirementStatus, Pair> = {
  met: ['Found on Host', 'Host 已满足'],
  missing: ['Missing on Host', 'Host 缺少'],
  unknown: ['Check yourself', '需自行确认'],
};

export function requirementStatusLabel(
  status: MarketplaceRequirementStatus,
  locale: DesktopLocale | undefined,
): string {
  return pick(locale, REQUIREMENT_STATUS_LABELS[status]);
}

/** True when the strongest evidence is a piwin run — the only claim worth a badge. */
export function isPiwinTested(evidence: readonly MarketplaceVerification[]): boolean {
  return evidence.some((item) => item.level === 'piwin-tested');
}

/** Strongest evidence first; the UI never upgrades author claims to "tested". */
export function verificationLabel(
  evidence: readonly MarketplaceVerification[],
  locale: DesktopLocale | undefined,
): string {
  if (evidence.some((item) => item.level === 'piwin-tested')) {
    return pick(locale, ['Tested in piwin', 'piwin 已实测']);
  }
  if (evidence.some((item) => item.level === 'static-scan')) {
    return pick(locale, ['Static scan only', '仅静态检查']);
  }
  return pick(locale, ['Author-declared', '作者声明']);
}

/** What installing this entry lets run on the Host, stated plainly. */
export function installRiskNotice(
  entry: MarketplaceCatalogEntry,
  locale: DesktopLocale | undefined,
): string {
  switch (entry.install.kind) {
    case 'agent':
      return pick(locale, [
        'Installs a declarative adapter on the Host, not the CLI. Grok runs with Host user permissions and its own account. CLI dependency installation is manual; uninstall preserves history and user-owned runtimes.',
        '在 Host 安装声明式适配插件，不包含 CLI。Grok 使用 Host 用户权限和自己的账号；CLI 依赖手动安装，卸载保留历史与用户运行时。',
      ]);
    case 'pi-package':
    case 'managed-extension':
      return pick(locale, [
        'Extensions run inside the agent with the Host user’s permissions. Installing may download dependencies and run install scripts.',
        '扩展在 Agent 内以 Host 当前用户权限运行；安装可能下载依赖并执行安装脚本。',
      ]);
    case 'skill':
      return pick(locale, [
        'Skills are instructions, but may ship scripts the agent can run on the Host.',
        'Skill 以指令为主，但可能附带 Agent 会在 Host 上运行的脚本。',
      ]);
    case 'mcp':
      return pick(locale, [
        'The MCP server runs as a separate process with the Host user’s permissions and is not covered by piwin permission rules.',
        'MCP 服务作为独立进程以 Host 当前用户权限运行，不受 piwin 权限规则约束。',
      ]);
  }
}
