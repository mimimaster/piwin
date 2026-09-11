/**
 * `piwin kb` — Host-owned knowledge base registry and search.
 */
import { resolve } from 'node:path';
import type { HostCommand, HostResponse, KnowledgeBaseSummary, KnowledgeSearchResult } from '@piwin/contracts';
import { hostSupportsKnowledgeBases } from '@piwin/contracts';
import { getPiwinRoot } from '@piwin/host-runtime';
import { openCliHost, type CliHostHandle } from './cli-host.js';

export const CLI_KB_USAGE = `Usage:
  piwin kb list [--mock]
  piwin kb add <folder> [--name n] [--mock]
  piwin kb remove <id> [--delete-index] [--mock]
  piwin kb search <query> [--kb id ...] [--tags t1,t2] [--limit n] [--mock]`;

export type KbHostClient = {
  handleCommand: (command: HostCommand) => Promise<HostResponse>;
  dispose: () => Promise<void>;
};

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

function readRepeatableOption(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== name) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    values.push(...value.split(',').map((item) => item.trim()).filter(Boolean));
    i += 1;
  }
  return values;
}

function parseMock(argv: string[]): boolean {
  return hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
}

export async function runKbCommand(argv: string[], log: (line: string) => void = console.log): Promise<void> {
  const mock = parseMock(argv);
  const host = await openCliHost({ mode: 'sdk', mock, piwinRoot: getPiwinRoot() });
  try {
    await runKbCommandWithClient(argv, host, log);
  } finally {
    await host.dispose();
  }
}

export async function runKbCommandWithClient(
  argv: string[],
  host: KbHostClient,
  log: (line: string) => void = console.log,
): Promise<void> {
  const sub = argv[1];
  if (!sub || sub === 'help' || sub === '--help') {
    console.error(CLI_KB_USAGE);
    process.exitCode = 1;
    return;
  }
  await assertKnowledgeCapability(host);
  if (sub === 'list') {
    await runList(host, log);
    return;
  }
  if (sub === 'add') {
    const folder = argv[2];
    if (!folder) {
      console.error('Usage: piwin kb add <folder> [--name n]');
      process.exitCode = 1;
      return;
    }
    await runAdd(host, resolve(folder), readOption(argv, '--name'), log);
    return;
  }
  if (sub === 'remove') {
    const id = argv[2];
    if (!id) {
      console.error('Usage: piwin kb remove <id> [--delete-index]');
      process.exitCode = 1;
      return;
    }
    await runRemove(host, id, hasFlag(argv, '--delete-index'), log);
    return;
  }
  if (sub === 'search') {
    const query = collectQuery(argv.slice(2));
    if (!query) {
      console.error('Usage: piwin kb search <query> [--kb id ...] [--limit n]');
      process.exitCode = 1;
      return;
    }
    const limitRaw = readOption(argv, '--limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    await runSearch(
      host,
      query,
      readRepeatableOption(argv, '--kb'),
      readRepeatableOption(argv, '--tags'),
      limit,
      log,
    );
    return;
  }
  console.error(CLI_KB_USAGE);
  process.exitCode = 1;
}

function collectQuery(tokens: string[]): string {
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.startsWith('--')) {
      if (token === '--kb' || token === '--limit' || token === '--name' || token === '--tags') {
        i += 1;
      }
      continue;
    }
    parts.push(token);
  }
  return parts.join(' ').trim();
}

async function assertKnowledgeCapability(host: KbHostClient): Promise<void> {
  const status = await host.handleCommand({ type: 'host/status' });
  if (!status.success) {
    throw new Error(status.error);
  }
  const capabilities = (status.data as { capabilities?: { knowledgeBases?: boolean } } | undefined)
    ?.capabilities;
  if (!hostSupportsKnowledgeBases(capabilities)) {
    throw new Error('This Host does not support knowledge bases. Update the Host.');
  }
}

async function runList(host: KbHostClient, log: (line: string) => void): Promise<void> {
  const response = await host.handleCommand({ type: 'knowledge/bases/list' });
  if (!response.success) {
    console.error(response.error);
    process.exitCode = 1;
    return;
  }
  const bases = (response.data as { bases?: KnowledgeBaseSummary[] } | undefined)?.bases ?? [];
  if (bases.length === 0) {
    log('No knowledge bases.');
    return;
  }
  for (const base of bases) {
    const extra = [
      base.state,
      `${base.documentCount} docs`,
      base.degraded ? 'degraded' : undefined,
      base.folderPath,
    ]
      .filter((item): item is string => typeof item === 'string' && item.length > 0)
      .join('\t');
    log(`${base.id}\t${base.name}\t${extra}`);
  }
}

async function runAdd(
  host: KbHostClient,
  folderPath: string,
  name: string | undefined,
  log: (line: string) => void,
): Promise<void> {
  const response = await host.handleCommand({
    type: 'knowledge/bases/add',
    folderPath,
    ...(name ? { name } : {}),
  });
  if (!response.success) {
    console.error(response.error);
    process.exitCode = 1;
    return;
  }
  const base = (response.data as { base?: KnowledgeBaseSummary } | undefined)?.base;
  if (!base) {
    console.error('add returned no knowledge base');
    process.exitCode = 1;
    return;
  }
  log(`added ${base.id}\t${base.name}\t${base.folderPath ?? ''}`);
}

async function runRemove(
  host: KbHostClient,
  baseId: string,
  deleteIndex: boolean,
  log: (line: string) => void,
): Promise<void> {
  const response = await host.handleCommand({
    type: 'knowledge/bases/remove',
    baseId,
    deleteIndex,
  });
  if (!response.success) {
    console.error(response.error);
    process.exitCode = 1;
    return;
  }
  log(`removed ${baseId}`);
}

async function runSearch(
  host: KbHostClient,
  query: string,
  baseIds: string[],
  tags: string[],
  limit: number | undefined,
  log: (line: string) => void,
): Promise<void> {
  const response = await host.handleCommand({
    type: 'knowledge/search',
    query,
    ...(baseIds.length > 0 ? { baseIds } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
  });
  if (!response.success) {
    console.error(response.error);
    process.exitCode = 1;
    return;
  }
  const result = response.data as KnowledgeSearchResult | undefined;
  const citations = result?.citations ?? [];
  log(`${citations.length} citation(s)`);
  for (const citation of citations) {
    const location =
      citation.startLine !== undefined
        ? `${citation.title}:${citation.startLine}`
        : citation.title;
    log(`\n[${citation.ref}] ${citation.baseName} · ${location}`);
    log(citation.text);
  }
}

export type { CliHostHandle };
