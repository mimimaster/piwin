import type {
  HostCommand,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceCatalogGetData,
  MarketplaceCatalogListData,
  MarketplaceInstalledListData,
  MarketplacePackageDetailData,
  MarketplacePiPackageInstallData,
  MarketplaceRequirementsCheckData,
} from '@piwin/contracts';
import { MARKETPLACE_CAPABILITY_KINDS, parsePiPackageSourceInput } from '@piwin/contracts';
import { hasFlag, readOption } from './cli-args.js';
import { openCliHost } from './cli-host.js';

/**
 * `piwin market`: read the curated catalog and the Host inventory through the
 * same Host commands Desktop uses. Installs stay on the per-kind commands
 * (`extension`, `skill`, `mcp`) so there is one install authority; Pi packages
 * by address use the same `marketplace/package-install` as Desktop.
 */

const USAGE = `Usage:
  piwin market search [query] [--type extension|skill|mcp]
  piwin market show <entry-id>
  piwin market check <entry-id>
  piwin market package-info <npm-name|github-url>
  piwin market install-package <npm-name[@version]|github-url|/absolute/path>
  piwin market installed [--session <id>] [--project <path>]
  piwin market uninstall-extension <extension-id>
  piwin market remove-mcp <server-id>`;

function parseKind(argv: string[]): MarketplaceCapabilityKind | undefined | null {
  const raw = readOption(argv, '--type');
  if (raw === undefined) return undefined;
  return (MARKETPLACE_CAPABILITY_KINDS as readonly string[]).includes(raw)
    ? (raw as MarketplaceCapabilityKind)
    : null;
}

function positional(argv: string[], index: number): string | undefined {
  const value = argv[index];
  return value && !value.startsWith('--') ? value : undefined;
}

function describeEntry(entry: MarketplaceCatalogEntry): string {
  const lines = [
    `${entry.entryId}  (${entry.kind}, ${entry.category})`,
    `  ${entry.name.en} — ${entry.summary.en}`,
    `  version ${entry.version} • ${entry.author} • ${entry.sourceLabel}`,
    `  evidence: ${entry.verification.map((item) => item.level).join(', ')}`,
  ];
  for (const requirement of entry.requirements) {
    lines.push(`  requires${requirement.required ? '' : ' (optional)'}: ${requirement.value}`);
  }
  for (const example of entry.examples) {
    lines.push(`  try: "${example.prompt.en}"`);
  }
  if (entry.homepage) lines.push(`  source: ${entry.homepage}`);
  return lines.join('\n');
}

function buildCommand(argv: string[]): HostCommand | string {
  const sub = argv[1] ?? 'search';
  switch (sub) {
    case 'search': {
      const kind = parseKind(argv);
      if (kind === null) return USAGE;
      const query = positional(argv, 2);
      return {
        type: 'marketplace/catalog-list',
        ...(query ? { query } : {}),
        ...(kind ? { kinds: [kind] } : {}),
      };
    }
    case 'show': {
      const entryId = positional(argv, 2);
      return entryId ? { type: 'marketplace/catalog-get', entryId } : USAGE;
    }
    case 'check': {
      const entryId = positional(argv, 2);
      return entryId ? { type: 'marketplace/requirements-check', entryId } : USAGE;
    }
    case 'package-info': {
      const parsed = parsePiPackageSourceInput(positional(argv, 2) ?? '');
      if (!parsed.ok || parsed.source.kind === 'local') return USAGE;
      return parsed.source.kind === 'npm'
        ? {
            type: 'marketplace/package-detail',
            entryId: `npm:${parsed.source.packageName}`,
            npmPackageName: parsed.source.packageName,
          }
        : {
            type: 'marketplace/package-detail',
            entryId: `github:${parsed.label}`,
            repositoryUrl: parsed.source.repositoryUrl,
          };
    }
    case 'install-package': {
      const parsed = parsePiPackageSourceInput(positional(argv, 2) ?? '');
      return parsed.ok ? { type: 'marketplace/package-install', source: parsed.source } : USAGE;
    }
    case 'installed': {
      const sessionId = readOption(argv, '--session');
      const projectPath = readOption(argv, '--project');
      return {
        type: 'marketplace/installed-list',
        ...(sessionId ? { sessionId } : {}),
        ...(projectPath ? { projectPath } : {}),
      };
    }
    case 'uninstall-extension': {
      const extensionId = positional(argv, 2);
      return extensionId ? { type: 'extensions/uninstall', extensionId } : USAGE;
    }
    case 'remove-mcp': {
      const serverId = positional(argv, 2);
      return serverId ? { type: 'mcp/remove', serverId } : USAGE;
    }
    default:
      return USAGE;
  }
}

function printResult(command: HostCommand, data: unknown): void {
  switch (command.type) {
    case 'marketplace/catalog-list': {
      const { entries } = data as MarketplaceCatalogListData;
      if (entries.length === 0) console.log('(no catalog entries match)');
      for (const entry of entries) {
        console.log(`${entry.entryId}\t${entry.kind}\t${entry.version}\t${entry.summary.en}`);
      }
      return;
    }
    case 'marketplace/catalog-get':
      console.log(describeEntry((data as MarketplaceCatalogGetData).entry));
      return;
    case 'marketplace/installed-list': {
      const { items } = data as MarketplaceInstalledListData;
      if (items.length === 0) console.log('(nothing installed)');
      // "installed" and "available now" are different facts; print both columns.
      for (const item of items) {
        const message = item.message ? `\t${item.message}` : '';
        console.log(
          `${item.availability}\t${item.kind}\t${item.capabilityId}\t${item.source}${message}`,
        );
      }
      return;
    }
    case 'marketplace/requirements-check': {
      const { results } = data as MarketplaceRequirementsCheckData;
      if (results.length === 0) console.log('(no requirements)');
      for (const result of results) {
        console.log(
          `${result.status}\t${result.kind}\t${result.value}${result.required ? '' : '\t(optional)'}`,
        );
      }
      return;
    }
    case 'marketplace/package-detail': {
      const detail = data as MarketplacePackageDetailData;
      console.log(
        `${detail.entryId}  license ${detail.license ?? '?'}  updated ${detail.updatedAt ?? '?'}`,
      );
      if (detail.remoteError) console.error(`partial: ${detail.remoteError}`);
      if (detail.readme) console.log(`\n${detail.readme}`);
      return;
    }
    case 'marketplace/package-install':
      console.log(`installed ${(data as MarketplacePiPackageInstallData).source}`);
      return;
    default:
      console.log(JSON.stringify(data));
  }
}

export async function commandMarket(argv: string[]): Promise<void> {
  const command = buildCommand(argv);
  if (typeof command === 'string') {
    console.error(command);
    process.exitCode = 1;
    return;
  }
  const mock = hasFlag(argv, '--mock') || process.env.PIWIN_MOCK === '1';
  const runtime = await openCliHost({ mode: 'sdk', mock });
  try {
    const response = await runtime.handleCommand(command);
    if (!response.success) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }
    printResult(command, response.data);
  } finally {
    await runtime.dispose();
  }
}
