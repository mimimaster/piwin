/**
 * Agent capability tools: `capability_search` finds vetted skills / MCP
 * servers / Pi extensions in the curated catalog plus community results
 * (skills.sh skills, official MCP registry servers, npm/GitHub Pi packages);
 * `capability_install` installs one by entry id. The per-call permission
 * prompt is the single confirmation — the agent does not ask again in chat.
 * Curated entries use the catalog's pinned source.
 */
import type {
  AgentPluginSource,
  HostToolRegistration,
  InstallSource,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  ToolResult,
} from '@piwin/contracts';
import { MARKETPLACE_CAPABILITY_KINDS, formatError } from '@piwin/contracts';
import { installPiPackage } from '@piwin/agent-host';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import {
  findCatalogEntry,
  listCatalogEntries,
  searchOfficialMcpRegistry,
  searchPiGithubRepos,
  searchPiNpmPackages,
  searchSkillsSh,
} from '@piwin/marketplace';
import type { McpLifecycleManager } from '@piwin/mcp';
import { loadMcpConfig } from '@piwin/mcp';
import { installSkill } from '@piwin/skills';
import type { ExtensionApplyOutcome } from './extension-tools.js';
import {
  readInstalledCatalogEntryIds,
  readInstalledSkillIds,
} from './marketplace/inventory-reader.js';
import { curatedSkillKeys } from './capability-community-skills.js';
import { installCommunity, searchCommunity, type CommunityPorts } from './capability-community.js';
import type { CommunityMcpCache } from './capability-community-mcp.js';
import { searchPiPackageSources } from './capability-community-packages.js';
import { connectMcpDraft } from './capability-mcp-connect.js';
import { resolvePiPackageSource } from './marketplace/pi-package-source.js';
import { getPiAgentDir } from './paths.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import { installAgentPlugin } from './agent-plugin-inventory.js';

/** Install side effects, injectable so tests never clone, npm-install or spawn. */
export type CapabilityInstallPorts = {
  installAgent: (rootDir: string, source: AgentPluginSource) => Promise<unknown>;
  installSkill: (input: { piwinRoot: string; source: InstallSource; name?: string }) => Promise<{
    skillId: string;
  }>;
  installPiPackage: (input: {
    source: string;
    workingDirectory: string;
    agentDirectory: string;
  }) => Promise<unknown>;
  installManagedExtension: (input: {
    piwinRoot: string;
    source: InstallSource;
    name?: string;
  }) => Promise<{ extensionId: string }>;
  enableManagedExtension: (piwinRoot: string, extensionId: string) => Promise<void>;
  listInstalledEntryIds: (piwinRoot: string) => Promise<Set<string>>;
} & CommunityPorts;

export type BuildCapabilityToolsOptions = {
  piwinRoot: string;
  mcpManager?: McpLifecycleManager | null;
  applyExtensions: (when: 'after-current-run') => Promise<ExtensionApplyOutcome>;
  ports?: Partial<CapabilityInstallPorts>;
};

const DEFAULT_PORTS: CapabilityInstallPorts = {
  installAgent: installAgentPlugin,
  installSkill: (input) => installSkill(input),
  installPiPackage: (input) => installPiPackage(input),
  installManagedExtension: (input) => installExtension(input),
  enableManagedExtension: async (piwinRoot, extensionId) => {
    await createExtensionRevisionStore(piwinRoot).setEnabled(extensionId, true);
  },
  listInstalledEntryIds: (piwinRoot) => readInstalledCatalogEntryIds(piwinRoot),
  searchCommunitySkills: (input) => searchSkillsSh(input),
  listInstalledSkillIds: (piwinRoot) => readInstalledSkillIds(piwinRoot),
  // Throws on a slow/failed registry so the agent is told, instead of seeing "no results".
  searchCommunityMcp: (input) => searchOfficialMcpRegistry(input),
  listMcpServerIds: async (piwinRoot) => new Set(Object.keys((await loadMcpConfig(piwinRoot)).mcpServers)),
  searchCommunityPackages: (input) =>
    searchPiPackageSources(input, { npm: searchPiNpmPackages, github: searchPiGithubRepos }),
};

function invalid(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

function failed(message: string): ToolResult {
  return { ok: false, code: 'execution-failed', message };
}

function isCapabilityKind(value: unknown): value is MarketplaceCapabilityKind {
  return typeof value === 'string' && (MARKETPLACE_CAPABILITY_KINDS as readonly string[]).includes(value);
}

function describeEntry(entry: MarketplaceCatalogEntry, installed: boolean): Record<string, unknown> {
  return {
    entryId: entry.entryId,
    kind: entry.kind,
    name: entry.name.en,
    nameZh: entry.name.zhCN,
    summary: entry.summary.en,
    summaryZh: entry.summary.zhCN,
    version: entry.version,
    author: entry.author,
    evidence: entry.verification.map((item) => item.level),
    requirements: entry.requirements.map(
      (requirement) => `${requirement.value}${requirement.required ? '' : ' (optional)'}`,
    ),
    examplePrompt: entry.examples[0]?.prompt.en,
    curated: true,
    installed,
  };
}

async function applyAfterTurn(
  options: BuildCapabilityToolsOptions,
  label: string,
): Promise<ToolResult> {
  const applied = await options.applyExtensions('after-current-run');
  return applied.ok
    ? {
        ok: true,
        output: `Installed ${label}. It activates after this turn (phase: ${applied.phase}); its tools are available on your next turn.`,
        details: { activated: true, phase: applied.phase },
      }
    : {
        ok: true,
        output: `Installed ${label}, but scheduling activation failed: ${applied.error}. It loads in new sessions.`,
        details: { activated: false },
      };
}

async function installEntry(
  entry: MarketplaceCatalogEntry,
  options: BuildCapabilityToolsOptions,
  ports: CapabilityInstallPorts,
): Promise<ToolResult> {
  const install = entry.install;
  switch (install.kind) {
    case 'agent':
      // A session backend installs as an extension. Writing the retired agent
      // inventory here would be a second switch the Host no longer launches.
      return failed(
        'agents-inventory-retired: install this session backend as a piwin extension, then enable it in Settings → Extensions.',
      );
    case 'skill': {
      const result = await ports.installSkill({
        piwinRoot: options.piwinRoot,
        source: install.source,
        ...(install.name ? { name: install.name } : {}),
      });
      return {
        ok: true,
        output: `Installed skill "${result.skillId}". It is usable from the next message (/${result.skillId}).`,
        details: { entryId: entry.entryId, skillId: result.skillId },
      };
    }
    case 'mcp':
      return connectMcpDraft({
        piwinRoot: options.piwinRoot,
        mcpManager: options.mcpManager,
        entryId: entry.entryId,
        serverId: install.serverId,
        draft: install.draft,
        prerequisites: entry.requirements.map((item) => item.value),
      });
    case 'pi-package': {
      await ports.installPiPackage({
        source: resolvePiPackageSource(install.source),
        workingDirectory: options.piwinRoot,
        agentDirectory: getPiAgentDir(),
      });
      return applyAfterTurn(options, `extension package "${entry.name.en}"`);
    }
    case 'managed-extension': {
      const installed = await ports.installManagedExtension({
        piwinRoot: options.piwinRoot,
        source: install.source,
        ...(install.name ? { name: install.name } : {}),
      });
      await ports.enableManagedExtension(options.piwinRoot, installed.extensionId);
      return applyAfterTurn(options, `extension "${installed.extensionId}"`);
    }
  }
}

export function buildCapabilityTools(options: BuildCapabilityToolsOptions): HostToolRegistration[] {
  const ports: CapabilityInstallPorts = { ...DEFAULT_PORTS, ...options.ports };
  const mcpCache: CommunityMcpCache = new Map();
  const community = {
    piwinRoot: options.piwinRoot,
    agentDirectory: getPiAgentDir(),
    mcpManager: options.mcpManager,
    ports,
    mcpCache,
    applyAfterTurn: (label: string) => applyAfterTurn(options, label),
  };
  return [
    {
      descriptor: {
        name: 'capability_search',
        description:
          'Search installable skills, MCP servers and Pi extensions. Covers piwin\'s curated ' +
          'catalog (curated: true; pinned, reviewed) and, with a query, community sources ' +
          '(curated: false): skills.sh skills (ranked by installs), the official MCP registry, ' +
          'and npm/GitHub Pi packages. Use when the user wants a capability that is not ' +
          'installed yet. Returns entry ids, purpose, prerequisites and whether each is already ' +
          'installed. Omit query to list the curated catalog. Prefer a curated match; otherwise ' +
          'pick the best community result yourself instead of asking the user to choose.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keywords in English or Chinese.' },
            kind: { type: 'string', enum: [...MARKETPLACE_CAPABILITY_KINDS] },
          },
        },
      },
      family: 'extensions-write',
      permissionSpec: {
        action: 'capabilities:search',
        risk: 'unknown',
        rememberable: false,
        readOnly: true,
      },
      async execute(args, signal) {
        const query = typeof args.query === 'string' ? args.query.trim() : undefined;
        if (args.kind !== undefined && !isCapabilityKind(args.kind)) {
          return invalid('kind must be "extension", "skill", "mcp" or "agent".');
        }
        const entries = listCatalogEntries({
          ...(query ? { query } : {}),
          ...(isCapabilityKind(args.kind) ? { kinds: [args.kind] } : {}),
        });
        const kind = isCapabilityKind(args.kind) ? args.kind : undefined;
        // Session backends have no community source.
        const withCommunity = Boolean(query) && kind !== 'agent';
        const [installed, found] = await Promise.all([
          ports.listInstalledEntryIds(options.piwinRoot),
          withCommunity && query
            ? searchCommunity(community, {
                query,
                kind,
                signal,
                excludeSkillKeys: curatedSkillKeys(listCatalogEntries({ kinds: ['skill'] })),
              })
            : Promise.resolve({ entries: [], errors: [] }),
        ]);
        const described = [
          ...entries.map((entry) => describeEntry(entry, installed.has(entry.entryId))),
          ...found.entries,
        ];
        const output = JSON.stringify(described, null, 2);
        return {
          ok: true,
          output:
            found.errors.length > 0
              ? `${output}\n\nCommunity sources unavailable: ${found.errors.join('; ')}`
              : output,
          details: { count: described.length, communityCount: found.entries.length },
        };
      },
    },
    {
      descriptor: {
        name: 'capability_install',
        description:
          'Install one entry by its entryId from capability_search (curated or community; ' +
          'community MCP ids must come from a search in this session). ' +
          'Call it directly once the user asked for the capability: the user approves each ' +
          'install in a permission prompt, so do not ask for confirmation in chat or ask ' +
          'whether it is curated. Mention prerequisites and, for community skills, that ' +
          'piwin has not reviewed them. Skills are usable from the next message, ' +
          'extensions after this turn, MCP servers in new sessions. An MCP server that needs ' +
          'env vars is saved but not started; the user fills them in Settings → MCP.',
        parameters: {
          type: 'object',
          properties: {
            entryId: {
              type: 'string',
              description:
                'e.g. "skill:doc-coauthoring", "skills.sh:anthropics/skills/pdf", ' +
                '"mcp-registry:io.github.acme/fs-mcp", "npm:pi-foo" or "github:owner/repo".',
            },
          },
          required: ['entryId'],
        },
      },
      family: 'extensions-write',
      permissionSpec: {
        action: 'capabilities:install',
        risk: 'unknown',
        rememberable: false,
        subjectBuilder: (args) => ({
          kind: 'tool',
          action: `capabilities:install ${typeof args.entryId === 'string' ? args.entryId : ''}`.trim(),
        }),
      },
      prepareArgs: passThroughPrepareArgs,
      // npm installs and git clones can be slow on a cold cache.
      executionSpec: { maxDurationMs: 10 * 60 * 1000 },
      async execute(args) {
        const entryId = typeof args.entryId === 'string' ? args.entryId.trim() : '';
        const communityResult = await installCommunity(community, entryId);
        if (communityResult) return communityResult;
        const entry = entryId ? findCatalogEntry(entryId) : undefined;
        if (!entry) {
          return invalid(`Unknown catalog entry "${entryId}". Call capability_search for valid ids.`);
        }
        if (entry.withdrawn) {
          return invalid(`"${entryId}" was withdrawn: ${entry.withdrawn.reason.en}`);
        }
        const installed = await ports.listInstalledEntryIds(options.piwinRoot);
        if (installed.has(entry.entryId)) {
          return { ok: true, output: `"${entry.entryId}" is already installed.`, details: { entryId } };
        }
        try {
          return await installEntry(entry, options, ports);
        } catch (error) {
          return failed(`Installing "${entry.entryId}" failed: ${formatError(error)}`);
        }
      },
    },
  ];
}
