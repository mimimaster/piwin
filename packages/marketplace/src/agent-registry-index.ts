import type { MarketplaceCatalogEntry, MarketplaceLocalizedText, MarketplaceRequirement } from '@piwin/contracts';
import { validateCatalogEntry } from './catalog/catalog.js';

export const DEFAULT_AGENT_REGISTRY_URL = 'https://extension.piwinwin.com/agents.json';
let cached: MarketplaceCatalogEntry[] = [];
let expiresAt = 0;
let pending: Promise<MarketplaceCatalogEntry[]> | undefined;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function localized(value: unknown): value is MarketplaceLocalizedText {
  return object(value) && typeof value.en === 'string' && typeof value.zhCN === 'string';
}
function requirement(value: unknown): value is MarketplaceRequirement {
  return object(value) && ['host-os', 'command', 'account', 'subscription', 'environment'].includes(String(value.kind)) && typeof value.value === 'string' && typeof value.required === 'boolean' && localized(value.description);
}

/** Separate schema: existing strict index.json v1 stays unchanged. */
export function parseAgentRegistryIndex(input: unknown): MarketplaceCatalogEntry[] {
  if (!object(input) || input.schemaVersion !== 1 || !Array.isArray(input.agents)) throw new Error('Invalid Agent registry index');
  const seen = new Set<string>();
  return input.agents.map((raw: unknown) => {
    if (!object(raw) || raw.kind !== 'agent' || typeof raw.entryId !== 'string' || !/^agent:[a-z0-9][a-z0-9-]{0,63}$/.test(raw.entryId) ||
        typeof raw.capabilityId !== 'string' || raw.entryId !== `agent:${raw.capabilityId}` ||
        typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.version) ||
        typeof raw.author !== 'string' || !localized(raw.name) || !localized(raw.summary) || !localized(raw.description) ||
        !object(raw.install) || raw.install.kind !== 'agent' || !object(raw.install.source) || raw.install.source.kind !== 'registry' ||
        raw.install.source.agentId !== raw.capabilityId || raw.install.source.version !== raw.version ||
        typeof raw.install.source.url !== 'string' || typeof raw.install.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.install.source.sha256) ||
        !Array.isArray(raw.requirements) || !raw.requirements.every(requirement) ||
        !Array.isArray(raw.examples) || !raw.examples.every((item) => object(item) && localized(item.title) && localized(item.prompt))) throw new Error('Invalid Agent registry entry');
    const url = new URL(raw.install.source.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !['extension.piwinwin.com', 'raw.githubusercontent.com'].includes(url.hostname)) throw new Error('Unreviewed Agent manifest source');
    if (seen.has(raw.entryId)) throw new Error('Duplicate Agent registry entry');
    seen.add(raw.entryId);
    if (raw.withdrawn !== undefined && (!object(raw.withdrawn) || !localized(raw.withdrawn.reason))) throw new Error('Invalid Agent withdrawal');
    const entry: MarketplaceCatalogEntry = {
      entryId: raw.entryId, capabilityId: raw.capabilityId, kind: 'agent', category: 'code-development',
      name: raw.name, summary: raw.summary, description: raw.description, version: raw.version,
      author: raw.author, sourceLabel: 'piwin-agents',
      install: { kind: 'agent', source: { kind: 'registry', agentId: raw.capabilityId, version: raw.version, url: url.href, sha256: raw.install.source.sha256 } },
      requirements: raw.requirements as MarketplaceRequirement[],
      examples: raw.examples as MarketplaceCatalogEntry['examples'],
      // A remote claim cannot promote itself to piwin-tested evidence.
      verification: [{ level: 'author-declared' }], featured: false,
      ...(raw.withdrawn !== undefined && object(raw.withdrawn) && localized(raw.withdrawn.reason) ? { withdrawn: { reason: raw.withdrawn.reason } } : {}),
    };
    const issues = validateCatalogEntry(entry);
    if (issues.length) throw new Error(issues.join('; '));
    return entry;
  });
}

export async function fetchAgentRegistryIndex(options: { url?: string; fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<MarketplaceCatalogEntry[]> {
  const response = await (options.fetchImpl ?? fetch)(options.url ?? process.env.PIWIN_AGENT_REGISTRY_URL ?? DEFAULT_AGENT_REGISTRY_URL, { signal: options.signal ?? AbortSignal.timeout(2_000) });
  if (!response.ok) throw new Error(`Agent registry HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 2_000_000) throw new Error('Agent registry too large');
  return parseAgentRegistryIndex(JSON.parse(body) as unknown);
}

export async function listRemoteAgentCatalog(): Promise<MarketplaceCatalogEntry[]> {
  if (Date.now() < expiresAt) return cached;
  pending ??= fetchAgentRegistryIndex().then((entries) => {
    cached = entries; expiresAt = Date.now() + 300_000; return entries;
  }).catch(() => {
    // agents.json may not exist yet; preserve both the offline catalog and old index.
    expiresAt = Date.now() + 30_000; return cached;
  }).finally(() => { pending = undefined; });
  return pending;
}
