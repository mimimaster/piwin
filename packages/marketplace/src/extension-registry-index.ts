/** Public piwin extension registry. The Host treats this index as untrusted data. */
import type { MarketplaceCatalogEntry } from '@piwin/contracts';
import { listRemoteAgentCatalog } from './agent-registry-index.js';
import { listCatalogEntries, validateCatalogEntry, type ListCatalogEntriesOptions } from './catalog/catalog.js';

export const DEFAULT_EXTENSION_REGISTRY_URL =
  'https://extension.piwinwin.com/index.json';
const REGISTRY_CACHE_MS = 5 * 60_000;
let cachedEntries: MarketplaceCatalogEntry[] = [];
let cacheExpiresAt = 0;
let pendingFetch: Promise<MarketplaceCatalogEntry[]> | undefined;

type RegistryVersion = { version: string; commit: string; yanked?: { reason: string } };
type RegistryEntry = {
  id: string;
  name: string;
  description?: string;
  repository: string;
  subdir?: string;
  owners: string[];
  versions: RegistryVersion[];
};

const COMMIT = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9][a-z0-9-]{0,63}$/;
const GITHUB_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const DEFAULT_COMMUNITY_EXTENSION_SUMMARIES: Record<string, { en: string; zhCN: string }> = {
  'mimimaster/commandcode-provider': {
    en: 'Adds Command Code login, Go/GOAT model access, dynamic model discovery, and quota commands to piwin. Adapted from patlux/pi-commandcode-provider.',
    zhCN: '为 piwin 接入 Command Code 登录、Go/GOAT 模型访问、动态模型发现及配额查询命令。改编自 patlux/pi-commandcode-provider。',
  },
  'mimimaster/kiro-provider': {
    en: 'Adds Kiro (AWS CodeWhisperer/Q) models (Claude Opus/Sonnet, DeepSeek, GPT-5.6-Luna) and native OAuth authentication to piwin. Adapted from mikeyobrien/pi-provider-kiro.',
    zhCN: '为 piwin 接入 Kiro (AWS CodeWhisperer/Q) 模型（Claude Opus/Sonnet、DeepSeek、GPT-5.6-Luna）及原生 OAuth 登录授权。改编自 mikeyobrien/pi-provider-kiro。',
  },
  'mimimaster/session-importer': {
    en: 'Import and resume coding conversations from Claude Code, Cursor, Codex, and OpenCode into piwin with interactive UI.',
    zhCN: '提供交互式界面，支持从 Claude Code、Cursor、Codex 和 OpenCode 导入并恢复历史对话会话。',
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRegistryEntry(value: unknown): RegistryEntry | undefined {
  if (!record(value) || typeof value['id'] !== 'string' || !ID.test(value['id'])) return;
  if (typeof value['name'] !== 'string' || !value['name'].trim()) return;
  if (typeof value['repository'] !== 'string' || !GITHUB_REPOSITORY.test(value['repository'])) return;
  if (!Array.isArray(value['owners']) || value['owners'].length === 0 ||
    !value['owners'].every((owner) => typeof owner === 'string' && owner.trim())) return;
  if (value['subdir'] !== undefined &&
    (typeof value['subdir'] !== 'string' || value['subdir'].includes('\\') ||
      value['subdir'].startsWith('/') ||
      value['subdir'].split('/').some((part) => !part || part === '.' || part === '..'))) return;
  if (!Array.isArray(value['versions'])) return;
  const versions = value['versions'].flatMap((item): RegistryVersion[] =>
    record(item) && typeof item['version'] === 'string' && item['version'].trim() &&
    typeof item['commit'] === 'string' && COMMIT.test(item['commit'])
      ? [{ version: item['version'], commit: item['commit'],
          ...(record(item['yanked']) && typeof item['yanked']['reason'] === 'string'
            ? { yanked: { reason: item['yanked']['reason'] } } : {}) }]
      : []);
  if (versions.length !== value['versions'].length) return;
  return {
    id: value['id'], name: value['name'], repository: value['repository'],
    owners: value['owners'] as string[], versions,
    ...(typeof value['description'] === 'string' ? { description: value['description'] } : {}),
    ...(typeof value['subdir'] === 'string' ? { subdir: value['subdir'] } : {}),
  };
}

/** Only the newest non-yanked version is offered to install. */
export function parseExtensionRegistryIndex(input: unknown): MarketplaceCatalogEntry[] {
  if (!record(input) || input['schemaVersion'] !== 1 || !Array.isArray(input['extensions'])) {
    throw new Error('Invalid piwin extension registry index');
  }
  const entries: MarketplaceCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const raw of input['extensions']) {
    const extension = parseRegistryEntry(raw);
    if (!extension || seen.has(extension.id)) throw new Error('Invalid or duplicate piwin extension entry');
    seen.add(extension.id);
    const version = extension.versions.find((item) => !item.yanked);
    if (!version) continue;
    const capabilityId = `piwin-${extension.id.replace('/', '-')}`;
    const rawSummary = extension.description?.trim() || `${extension.name} for piwin`;
    const known = DEFAULT_COMMUNITY_EXTENSION_SUMMARIES[extension.id];
    const hasChinese = /[\u4e00-\u9fa5]/.test(rawSummary);
    const summaryZh = hasChinese ? rawSummary : (known?.zhCN ?? rawSummary);
    const summaryEn = hasChinese ? (known?.en ?? rawSummary) : rawSummary;
    const summary = { en: summaryEn, zhCN: summaryZh };
    const entry: MarketplaceCatalogEntry = {
      entryId: `extension:${extension.id}`,
      capabilityId,
      kind: 'extension',
      category: 'external-service',
      name: { en: extension.name, zhCN: extension.name },
      summary,
      description: summary,
      version: version.version,
      author: extension.id.split('/')[0] ?? extension.owners[0] ?? 'unknown',
      homepage: extension.repository,
      sourceLabel: 'piwin-extensions',
      install: {
        kind: 'managed-extension',
        name: capabilityId,
        source: { kind: 'git', url: extension.repository, ref: version.commit,
          ...(extension.subdir ? { subdir: extension.subdir } : {}) },
      },
      requirements: [],
      examples: [{ title: { en: 'Use this extension', zhCN: '使用此扩展' },
        prompt: { en: `Use ${extension.name} in this task.`, zhCN: `在当前任务中使用 ${extension.name}。` } }],
      verification: [{ level: 'author-declared' }],
      featured: false,
    };
    const issues = validateCatalogEntry(entry);
    if (issues.length > 0) throw new Error(`Invalid piwin extension entry: ${issues.join('; ')}`);
    entries.push(entry);
  }
  return entries;
}

export async function fetchExtensionRegistryIndex(options: {
  url?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
} = {}): Promise<MarketplaceCatalogEntry[]> {
  const response = await (options.fetchImpl ?? fetch)(
    options.url ?? process.env.PIWIN_EXTENSION_REGISTRY_URL ?? DEFAULT_EXTENSION_REGISTRY_URL,
    { signal: options.signal ?? AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`piwin extension registry returned HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('piwin extension registry index is too large');
  return parseExtensionRegistryIndex(JSON.parse(body) as unknown);
}

export async function listMarketplaceWithExtensions(
  options: ListCatalogEntriesOptions = {},
  fetchOptions: Parameters<typeof fetchExtensionRegistryIndex>[0] = {},
): Promise<MarketplaceCatalogEntry[]> {
  const remoteAgents = Object.keys(fetchOptions).length === 0 ? listRemoteAgentCatalog() : Promise.resolve([]);
  let remote = cachedEntries;
  if (Object.keys(fetchOptions).length > 0 || Date.now() >= cacheExpiresAt) {
    pendingFetch ??= fetchExtensionRegistryIndex(fetchOptions).then((entries) => {
      if (Object.keys(fetchOptions).length === 0) {
        cachedEntries = entries;
        cacheExpiresAt = Date.now() + REGISTRY_CACHE_MS;
      }
      return entries;
    }).finally(() => { pendingFetch = undefined; });
    try {
      remote = await pendingFetch;
    } catch {
      // Keep the last successful community index and the offline catalog.
      cacheExpiresAt = Date.now() + 30_000;
    }
  }
  // A caller testing/overriding the extension source must not silently fetch a different source.
  const agents = await remoteAgents;
  const merged = new Map([...listCatalogEntries({ includeWithdrawn: true }), ...remote, ...agents].map((entry) => [entry.entryId, entry]));
  return listCatalogEntries(options, [...merged.values()]);
}
