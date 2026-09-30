import type { MarketplaceCatalogEntry } from '@piwin/contracts';

/** Adapter only. The Grok binary and account are explicitly separate prerequisites. */
export const AGENT_CATALOG: readonly MarketplaceCatalogEntry[] = [{
  entryId: 'agent:grok', capabilityId: 'grok', kind: 'agent', category: 'code-development',
  name: { en: 'Grok Build', zhCN: 'Grok Build' },
  summary: { en: 'Run Grok Build through ACP in piwin.', zhCN: '通过 ACP 在 piwin 中运行 Grok Build。' },
  description: {
    en: 'Installs a declarative adapter on the Host, not the Grok CLI. Grok uses its own account, permissions, MCP and history. Uninstall keeps your history and user-owned CLI.',
    zhCN: '在 Host 安装声明式适配插件，不包含 Grok CLI。Grok 使用自己的账号、权限、MCP 和历史；卸载保留历史与用户 CLI。',
  },
  version: '1.0.0', author: 'piwin', homepage: 'https://grok.com', sourceLabel: 'bundled-reviewed-adapter',
  install: { kind: 'agent', source: { kind: 'bundled', agentId: 'grok' } },
  requirements: [
    { kind: 'host-os', value: 'macos', required: true, description: { en: 'macOS Host is verified; Windows/Linux are not yet verified.', zhCN: '已验证 macOS Host；Windows/Linux 尚未验证。' } },
    { kind: 'command', value: 'grok', required: true, description: { en: 'Install the official Grok Build CLI on the Host.', zhCN: '在 Host 安装官方 Grok Build CLI。' } },
    { kind: 'account', value: 'Grok Build account', required: true, description: { en: 'Sign in using grok login on the Host; model usage may incur costs.', zhCN: '在 Host 使用 grok login 登录；模型使用可能计费。' } },
  ],
  examples: [{ title: { en: 'Start a Grok session', zhCN: '新建 Grok 会话' }, prompt: { en: 'Create a new Grok Build session in this workspace.', zhCN: '在当前工作目录新建 Grok Build 会话。' } }],
  verification: [{ level: 'author-declared', notes: { en: 'ACP observed on Grok CLI 1.0.41/1.0.44; installer distribution is not verified.', zhCN: '已观察 CLI 1.0.41/1.0.44 的 ACP；CLI 安装分发尚未验证。' } }],
  featured: true,
}];
