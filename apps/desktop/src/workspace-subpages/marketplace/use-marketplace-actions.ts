/**
 * Marketplace mutations. Each install descriptor / removal route maps to the
 * existing domain command the Host already owns — there is no marketplace
 * install authority here. Operation state follows real request phases, and
 * every flow ends by re-reading the Host inventory instead of patching it.
 */
import { useRef, useState } from 'react';
import type {
  ExtensionsUninstallData,
  HostCommand,
  HostResponse,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  McpServerHealth,
} from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { localizedText } from './marketplace-copy.js';
import { applyExtensionsToSession, describeExtensionChange } from './marketplace-session-apply.js';
import type { MarketOperation, MarketplaceToast } from './marketplace-types.js';

type Request = (command: HostCommand) => Promise<HostResponse>;

export type MarketplaceActions = {
  operations: Readonly<Record<string, MarketOperation>>;
  install: (entry: MarketplaceCatalogEntry) => Promise<void>;
  remove: (item: MarketplaceInstalledItem) => Promise<void>;
  toggle: (item: MarketplaceInstalledItem) => Promise<void>;
};

class MarketplaceRequestError extends Error {
  override readonly name = 'MarketplaceRequestError';
}

async function send(request: Request, command: HostCommand): Promise<unknown> {
  const response = await request(command);
  if (!response.success) throw new MarketplaceRequestError(response.error);
  return response.data;
}

export function useMarketplaceActions(options: {
  locale?: DesktopLocale | undefined;
  sessionId?: string | null | undefined;
  request: Request;
  refreshInventory: () => Promise<void>;
  showToast: (toast: MarketplaceToast) => void;
}): MarketplaceActions {
  const zh = options.locale === 'zh-CN';
  const [operations, setOperations] = useState<Record<string, MarketOperation>>({});
  const optionsRef = useRef(options);
  optionsRef.current = options;

  function setOperation(key: string, operation: MarketOperation | null): void {
    setOperations((current) => {
      const next = { ...current };
      if (operation === null) delete next[key];
      else next[key] = operation;
      return next;
    });
  }

  async function run(
    key: string,
    name: string,
    body: (phase: (operation: MarketOperation) => void) => Promise<MarketplaceToast>,
  ): Promise<void> {
    const { refreshInventory, showToast } = optionsRef.current;
    try {
      const toast = await body((operation) => setOperation(key, operation));
      showToast(toast);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast({ type: 'error', title: zh ? `[${name}] 操作失败` : `[${name}] failed`, text: message });
    } finally {
      setOperation(key, null);
      await refreshInventory();
    }
  }

  async function install(entry: MarketplaceCatalogEntry): Promise<void> {
    const { request, sessionId, locale } = optionsRef.current;
    const name = localizedText(entry.name, locale);
    const descriptor = entry.install;
    await run(entry.entryId, name, async (phase) => {
      phase('installing');
      switch (descriptor.kind) {
        case 'pi-package': {
          await send(request, { type: 'marketplace/package-install', source: descriptor.source });
          phase('applying');
          return describeExtensionChange(name, 'installed', await applyExtensionsToSession(request, sessionId), locale);
        }
        case 'managed-extension': {
          const installed = (await send(request, {
            type: 'extensions/install',
            source: descriptor.source,
            ...(descriptor.name ? { name: descriptor.name } : {}),
          })) as { extensionId: string; configuredEnabled?: boolean };
          if (installed.configuredEnabled !== true) {
            phase('enabling');
            await send(request, { type: 'extensions/set_enabled', extensionId: installed.extensionId, enabled: true });
          }
          phase('applying');
          return describeExtensionChange(name, 'installed', await applyExtensionsToSession(request, sessionId), locale);
        }
        case 'skill': {
          await send(request, {
            type: 'skills/install',
            source: descriptor.source,
            ...(descriptor.name ? { name: descriptor.name } : {}),
          });
          return {
            type: 'success',
            title: zh ? `[${name}] 已安装` : `[${name}] installed`,
            text: zh ? '下一条消息起即可使用。' : 'Usable from your next message.',
          };
        }
        case 'mcp': {
          await send(request, {
            type: 'mcp/registry-install-draft',
            serverId: descriptor.serverId,
            draft: descriptor.draft,
          });
          phase('starting');
          const started = (await send(request, { type: 'mcp/start', serverId: descriptor.serverId })) as {
            health: McpServerHealth;
          };
          const health = started.health;
          if (health.status === 'running' && !health.lastError) {
            return {
              type: 'success',
              title: zh ? `[${name}] 已连接` : `[${name}] connected`,
              text: zh ? `发现 ${health.toolCount} 个工具。` : `${health.toolCount} tools discovered.`,
            };
          }
          return {
            type: 'warning',
            title: zh ? `[${name}] 已保存配置` : `[${name}] saved`,
            text: zh
              ? `但启动失败：${health.lastError ?? health.status}`
              : `but it did not start: ${health.lastError ?? health.status}`,
          };
        }
      }
    });
  }

  async function remove(item: MarketplaceInstalledItem): Promise<void> {
    const { request, sessionId, locale } = optionsRef.current;
    const route = item.removal;
    if (!route) return;
    await run(item.installationKey, item.name, async (phase) => {
      phase('removing');
      switch (route.command) {
        case 'extensions/uninstall': {
          const data = (await send(request, {
            type: 'extensions/uninstall',
            extensionId: item.capabilityId,
          })) as ExtensionsUninstallData;
          phase('applying');
          const outcome = await applyExtensionsToSession(request, sessionId);
          const toast = describeExtensionChange(item.name, 'removed', outcome, locale);
          return data.state === 'pending-removal' && outcome.kind !== 'failed'
            ? {
                ...toast,
                text: zh
                  ? '已停止加载；仍在使用它的会话结束后清理文件。'
                  : 'No longer loaded; files are cleaned up once sessions using it move on.',
              }
            : toast;
        }
        case 'marketplace/package-remove': {
          await send(request, { type: 'marketplace/package-remove', packageSource: route.packageSource });
          phase('applying');
          return describeExtensionChange(item.name, 'removed', await applyExtensionsToSession(request, sessionId), locale);
        }
        case 'skills/uninstall':
          await send(request, { type: 'skills/uninstall', skillId: item.capabilityId });
          return { type: 'success', title: zh ? `[${item.name}] 已卸载` : `[${item.name}] removed`, text: '' };
        case 'mcp/remove':
          await send(request, { type: 'mcp/remove', serverId: item.capabilityId });
          return {
            type: 'success',
            title: zh ? `[${item.name}] 已移除` : `[${item.name}] removed`,
            text: zh ? '服务已停止并从配置中删除。' : 'Server stopped and removed from config.',
          };
      }
    });
  }

  async function toggle(item: MarketplaceInstalledItem): Promise<void> {
    const { request, sessionId, locale } = optionsRef.current;
    const enabled = !item.enabled;
    await run(item.installationKey, item.name, async (phase) => {
      phase('toggling');
      if (item.kind === 'skill') {
        await send(request, { type: 'skills/set_enabled', skillId: item.capabilityId, enabled });
        return {
          type: 'success',
          title: zh ? `[${item.name}] ${enabled ? '已启用' : '已停用'}` : `[${item.name}] ${enabled ? 'enabled' : 'disabled'}`,
          text: '',
        };
      }
      await send(request, { type: 'extensions/set_enabled', extensionId: item.capabilityId, enabled });
      phase('applying');
      return describeExtensionChange(
        item.name,
        enabled ? 'enabled' : 'disabled',
        await applyExtensionsToSession(request, sessionId),
        locale,
      );
    });
  }

  return { operations, install, remove, toggle };
}
