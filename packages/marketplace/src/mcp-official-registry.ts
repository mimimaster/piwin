/**
 * Official MCP registry (registry.modelcontextprotocol.io, schema
 * 2025-12-11) → registry cards with a runnable draft. A stdio package (npm via
 * `npx`, PyPI via `uvx`) is preferred; otherwise a remote endpoint becomes a
 * `url` draft when it needs no header the user must supply. Remote servers
 * that need a secret header stay listed with `requiresSse` (not one-click).
 */
import type { McpRegistryCard, McpServerConfig } from '@piwin/contracts';
import { isRemoteMcpServerConfig } from '@piwin/contracts';

export const OFFICIAL_MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
const NPM_IDENTIFIER = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PYPI_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RegistryRecord = Record<string, unknown>;

function asRecord(value: unknown): RegistryRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RegistryRecord) : null;
}

function readString(record: RegistryRecord | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Local server id: last path segment of the registry name (`io.github.acme/fs-mcp` → `fs-mcp`). */
export function officialMcpServerId(registryName: string): string {
  const last = registryName.split('/').filter(Boolean).at(-1) ?? registryName;
  return last.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server';
}

/** Positional/named package arguments that carry a fixed value; undefined when a required one has none. */
function packageArguments(pkg: RegistryRecord): string[] | undefined {
  const args: string[] = [];
  for (const raw of asArray(pkg.packageArguments)) {
    const argument = asRecord(raw);
    const value = readString(argument, 'value') ?? readString(argument, 'default');
    if (!value) {
      if (argument?.isRequired === true) return undefined;
      continue;
    }
    const name = readString(argument, 'name');
    if (argument?.type === 'named' && name) args.push(name);
    args.push(value);
  }
  return args;
}

function environment(pkg: RegistryRecord): { env: Record<string, string>; required: string[] } {
  const env: Record<string, string> = {};
  const required: string[] = [];
  for (const raw of asArray(pkg.environmentVariables)) {
    const variable = asRecord(raw);
    const name = readString(variable, 'name');
    if (!name || !ENV_NAME.test(name)) continue;
    const value = readString(variable, 'value') ?? readString(variable, 'default');
    if (value) env[name] = value;
    else if (variable?.isRequired === true) required.push(name);
  }
  return { env, required };
}

function stdioDraft(
  pkg: RegistryRecord,
): { draft: McpServerConfig; required: string[]; version?: string } | undefined {
  const transport = readString(asRecord(pkg.transport), 'type');
  if (transport !== undefined && transport !== 'stdio') return undefined;
  const identifier = readString(pkg, 'identifier');
  const version = readString(pkg, 'version');
  const pinned = version && VERSION.test(version) ? version : undefined;
  const args = packageArguments(pkg);
  if (!identifier || !args) return undefined;
  let draft: McpServerConfig;
  switch (readString(pkg, 'registryType')) {
    case 'npm':
      if (!NPM_IDENTIFIER.test(identifier)) return undefined;
      draft = { command: 'npx', args: ['-y', pinned ? `${identifier}@${pinned}` : identifier, ...args] };
      break;
    case 'pypi':
      if (!PYPI_IDENTIFIER.test(identifier)) return undefined;
      draft = { command: 'uvx', args: [pinned ? `${identifier}==${pinned}` : identifier, ...args] };
      break;
    default:
      return undefined;
  }
  const { env, required } = environment(pkg);
  if (Object.keys(env).length > 0) draft.env = env;
  return { draft, required, ...(pinned ? { version: pinned } : {}) };
}

/**
 * First registry remote the Host can reach without user input. Required
 * headers (usually an API key) have no safe default, so such remotes are
 * skipped; fixed header values are kept.
 */
function remoteDraft(server: RegistryRecord): McpServerConfig | undefined {
  for (const remote of asArray(server.remotes).map((value) => asRecord(value))) {
    const url = readString(remote, 'url');
    const kind = readString(remote, 'type');
    if (!url || !/^https?:\/\//i.test(url) || url.includes('{')) continue;
    if (kind !== 'streamable-http' && kind !== 'sse') continue;
    const headers: Record<string, string> = {};
    let needsInput = false;
    for (const header of asArray(remote?.headers).map((value) => asRecord(value))) {
      const name = readString(header, 'name');
      const value = readString(header, 'value') ?? readString(header, 'default');
      if (name && value && !value.includes('{')) headers[name] = value;
      else if (header?.isRequired === true) needsInput = true;
    }
    if (needsInput) continue;
    return {
      type: kind === 'sse' ? 'sse' : 'http',
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }
  return undefined;
}

/** One registry `server` object → card, or undefined when it has no name. */
export function cardFromOfficialServer(value: unknown): McpRegistryCard | undefined {
  const server = asRecord(value);
  const name = readString(server, 'name');
  if (!server || !name) return undefined;
  const card: McpRegistryCard = {
    id: `official:${name}`,
    title: readString(server, 'title') ?? name,
    description: readString(server, 'description') ?? 'Official MCP registry entry',
    source: 'official',
  };
  const website = readString(server, 'websiteUrl');
  const repositoryUrl = readString(asRecord(server.repository), 'url');
  if (repositoryUrl) card.repositoryUrl = repositoryUrl;
  if (website ?? repositoryUrl) card.homepage = (website ?? repositoryUrl) as string;
  const runnable = asArray(server.packages)
    .map((pkg) => asRecord(pkg))
    .flatMap((pkg) => {
      const draft = pkg ? stdioDraft(pkg) : undefined;
      return draft ? [draft] : [];
    })
    // A package needing no user input beats one with required env vars.
    .sort((left, right) => left.required.length - right.required.length)[0];
  if (runnable) {
    card.installDraft = runnable.draft;
    if (runnable.required.length > 0) card.requiredEnv = runnable.required;
    if (runnable.version) card.version = runnable.version;
  } else {
    card.version = readString(server, 'version') ?? 'latest';
    const remote = remoteDraft(server);
    if (remote) card.installDraft = remote;
    else card.requiresSse = asArray(server.remotes).length > 0;
  }
  return card;
}

/**
 * Registry list payload → one card per server name. The registry returns every
 * published version; the entry flagged `isLatest` wins, else the last listed.
 */
export function parseOfficialRegistryServers(payload: unknown): McpRegistryCard[] {
  const byName = new Map<string, { card: McpRegistryCard; latest: boolean }>();
  for (const raw of asArray(asRecord(payload)?.servers)) {
    const item = asRecord(raw);
    const card = cardFromOfficialServer(item?.server);
    if (!card) continue;
    const meta = asRecord(asRecord(item?._meta)?.['io.modelcontextprotocol.registry/official']);
    const latest = meta?.isLatest === true;
    const previous = byName.get(card.id);
    if (!previous || latest || !previous.latest) byName.set(card.id, { card, latest });
  }
  return [...byName.values()].map((entry) => entry.card);
}

/** The registry's search is a slow full scan (20–40 s observed); callers run it apart from fast sources. */
export const OFFICIAL_MCP_SEARCH_TIMEOUT_MS = 45_000;
// Matches come back alphabetically; a wider page leaves room for runnable servers after the sort.
const SEARCH_LIMIT = 100;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 50;
/** Repeat searches (agent retry, Desktop re-render) should not pay the scan again. */
const searchCache = new Map<string, { at: number; cards: McpRegistryCard[] }>();

export type SearchOfficialMcpRegistryOptions = {
  query: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => number;
};

/** Official registry search; throws on HTTP/network failure or timeout. */
export async function searchOfficialMcpRegistry(
  options: SearchOfficialMcpRegistryOptions,
): Promise<McpRegistryCard[]> {
  const query = options.query.trim();
  const now = options.now ?? Date.now;
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.cards;
  const url = new URL(OFFICIAL_MCP_REGISTRY_URL);
  url.searchParams.set('limit', String(SEARCH_LIMIT));
  url.searchParams.set('version', 'latest');
  if (query) url.searchParams.set('search', query);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? OFFICIAL_MCP_SEARCH_TIMEOUT_MS);
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`MCP registry search failed: HTTP ${response.status}`);
  // The registry returns names alphabetically; local packages go first, then
  // remotes that work without a key, so a short list is not all key-gated endpoints.
  const parsed = parseOfficialRegistryServers(await response.json());
  const rank = (card: McpRegistryCard): number =>
    card.installDraft === undefined ? 2 : isRemoteMcpServerConfig(card.installDraft) ? 1 : 0;
  // Array.prototype.sort is stable, so the registry order holds within a rank.
  const cards = [...parsed].sort((left, right) => rank(left) - rank(right));
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { at: now(), cards });
  return cards;
}

/** Test hook: forget cached searches. */
export function clearOfficialMcpSearchCache(): void {
  searchCache.clear();
}
