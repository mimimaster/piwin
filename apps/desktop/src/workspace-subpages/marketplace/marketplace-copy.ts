/**
 * Localized labels for marketplace enums. Pure so the mapping is unit-tested
 * once instead of re-spelled in every card.
 */
import type {
  MarketplaceAvailability,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceCategory,
  MarketplaceLocalizedText,
  MarketplaceVerification,
} from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketOperation } from './marketplace-types.js';

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

const KIND_LABELS: Record<MarketplaceCapabilityKind | 'piwin-extension', Pair> = {
  extension: ['extension', 'extension'],
  'piwin-extension': ['piwin extensions', 'piwin 扩展'],
  skill: ['skill', 'skill'],
  mcp: ['mcp', 'mcp'],
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

export function categoryLabel(category: MarketplaceCategory, locale: DesktopLocale | undefined): string {
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

export function operationLabel(operation: MarketOperation, locale: DesktopLocale | undefined): string {
  return pick(locale, OPERATION_LABELS[operation]);
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
      return pick(locale, ['Installs a declarative adapter on the Host, not the CLI. Grok runs with Host user permissions and its own account. CLI dependency installation is manual; uninstall preserves history and user-owned runtimes.', '在 Host 安装声明式适配插件，不包含 CLI。Grok 使用 Host 用户权限和自己的账号；CLI 依赖手动安装，卸载保留历史与用户运行时。']);
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
