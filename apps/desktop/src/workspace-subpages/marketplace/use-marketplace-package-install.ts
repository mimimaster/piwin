/**
 * Install a live-search Pi package (npm / GitHub) after the user accepts the
 * community-code risk. Shares the session-apply outcome with curated installs.
 */
import { useRef, useState } from 'react';
import type {
  HostCommand,
  HostResponse,
  MarketplacePiPackageSource,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { withMcpEnvPlaceholders } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { applyExtensionsToSession, describeExtensionChange } from './marketplace-session-apply.js';
import type { MarketplaceToast } from './marketplace-types.js';

export type MarketplacePackageInstallState = 'installing' | 'installed' | 'failed';

export type MarketplacePackageInstall = {
  target: MarketplaceSearchHit | null;
  states: Record<string, MarketplacePackageInstallState>;
  select: (hit: MarketplaceSearchHit) => void;
  cancel: () => void;
  confirm: (hit: MarketplaceSearchHit) => Promise<void>;
  /** "Install from address": a user-typed npm / GitHub / Host-path source. Resolves true on success. */
  installSource: (source: MarketplacePiPackageSource, label: string) => Promise<boolean>;
};

export function useMarketplacePackageInstall(options: {
  locale?: DesktopLocale | undefined;
  sessionId?: string | null | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  showToast: (toast: MarketplaceToast) => void;
  onInstalled?: () => Promise<void>;
}): MarketplacePackageInstall {
  const [target, setTarget] = useState<MarketplaceSearchHit | null>(null);
  const [states, setStates] = useState<Record<string, MarketplacePackageInstallState>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  async function confirm(hit: MarketplaceSearchHit): Promise<void> {
    const { request, sessionId, locale, showToast, onInstalled } = optionsRef.current;
    const zh = locale === 'zh-CN';
    setTarget(null);
    setStates((current) => ({ ...current, [hit.entryId]: 'installing' }));
    try {
      if (hit.source === 'mcp-registry') {
        // The registry's own package draft (pinned npx/uvx command); never a
        // command guessed from the display name.
        const draft = hit.mcpDraft;
        if (!draft) {
          throw new Error(
            zh
              ? '该服务只提供远程端点；piwin 目前仅支持本地 stdio MCP 服务。'
              : 'This server is remote-only; piwin runs local stdio MCP servers only.',
          );
        }
        const serverId =
          hit.mcpServerId ?? (hit.name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'mcp-server');
        const requiredEnv = hit.requiredEnv ?? [];
        const installRes = await request({
          type: 'mcp/registry-install-draft',
          serverId,
          draft: withMcpEnvPlaceholders(draft, requiredEnv),
        });
        if (!installRes.success) throw new Error(installRes.error);
        setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
        if (requiredEnv.length > 0) {
          // Starting without the required values would only fail; let the user fill them first.
          showToast({
            type: 'warning',
            title: zh ? `[${hit.name}] 已保存配置` : `[${hit.name}] saved`,
            text: zh
              ? `在 设置 → MCP 填写 ${requiredEnv.join('、')} 后启动。`
              : `Fill in ${requiredEnv.join(', ')} in Settings → MCP, then start it.`,
          });
          return;
        }
        const started = await request({ type: 'mcp/start', serverId });
        const health = started.success
          ? (
              started.data as {
                health?: { status?: string; lastError?: string; toolCount?: number };
              }
            ).health
          : undefined;
        if (health?.status === 'running' && !health.lastError) {
          showToast({
            type: 'success',
            title: zh ? `[${hit.name}] MCP 服务已连接` : `[${hit.name}] MCP server connected`,
            text: zh
              ? `发现 ${health.toolCount ?? 0} 个工具。`
              : `${health.toolCount ?? 0} tools discovered.`,
          });
        } else {
          const reason = started.success
            ? (health?.lastError ?? health?.status ?? 'unknown')
            : started.error;
          showToast({
            type: 'warning',
            title: zh ? `[${hit.name}] 已保存配置` : `[${hit.name}] saved`,
            text: zh ? `但启动失败：${reason}` : `but it did not start: ${reason}`,
          });
        }
        return;
      }
      if (hit.source === 'skill') {
        // `skillSource` is exact (curated: pinned commit + subdir). Without it the
        // Host locates the folder named `skillName` inside the repository.
        const source =
          hit.skillSource ??
          (hit.repositoryUrl ? { kind: 'git' as const, url: hit.repositoryUrl } : null);
        if (!source) {
          throw new Error(
            zh ? '该条目缺少可安装的仓库地址。' : 'This result has no installable repository URL.',
          );
        }
        const skillName = hit.name;
        const installRes = await request({ type: 'skills/install', source, name: skillName });
        if (!installRes.success) throw new Error(installRes.error);
        setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
        showToast({
          type: 'success',
          title: zh ? `[${skillName}] Skill 已安装` : `[${skillName}] Skill installed`,
          text: zh ? '下一条消息起即可使用。' : 'Usable from your next message.',
        });
        return;
      }
      const source =
        hit.source === 'github'
          ? hit.repositoryUrl
            ? { kind: 'git' as const, repositoryUrl: hit.repositoryUrl }
            : null
          : { kind: 'npm' as const, packageName: hit.name };
      if (!source) {
        throw new Error(
          zh ? '该条目缺少可安装的仓库地址。' : 'This result has no installable repository URL.',
        );
      }
      const response = await request({ type: 'marketplace/package-install', source });
      if (!response.success) {
        throw new Error(response.error);
      }
      setStates((current) => ({ ...current, [hit.entryId]: 'installed' }));
      showToast(
        describeExtensionChange(
          hit.name,
          'installed',
          await applyExtensionsToSession(request, sessionId),
          locale,
        ),
      );
    } catch (error) {
      setStates((current) => ({ ...current, [hit.entryId]: 'failed' }));
      const message = error instanceof Error ? error.message : String(error);
      showToast({
        type: 'error',
        title: zh ? '安装失败' : 'Installation Failed',
        text: zh
          ? `安装 [${hit.name}] 失败：${message}`
          : `Could not install [${hit.name}]: ${message}`,
      });
    } finally {
      await onInstalled?.();
    }
  }

  async function installSource(
    source: MarketplacePiPackageSource,
    label: string,
  ): Promise<boolean> {
    const { request, sessionId, locale, showToast, onInstalled } = optionsRef.current;
    const zh = locale === 'zh-CN';
    try {
      const response = await request({ type: 'marketplace/package-install', source });
      if (!response.success) throw new Error(response.error);
      showToast(
        describeExtensionChange(
          label,
          'installed',
          await applyExtensionsToSession(request, sessionId),
          locale,
        ),
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({
        type: 'error',
        title: zh ? '安装失败' : 'Installation Failed',
        text: zh ? `安装 [${label}] 失败：${message}` : `Could not install [${label}]: ${message}`,
      });
      return false;
    } finally {
      await onInstalled?.();
    }
  }

  return {
    target,
    states,
    select: setTarget,
    cancel: () => setTarget(null),
    confirm,
    installSource,
  };
}
