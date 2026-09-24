/**
 * Agent tools for the curated capability catalog: `capability_search` finds
 * vetted skills / MCP servers / Pi extensions, `capability_install` installs
 * one by catalog entry id. Discovery and install happen in conversation
 * instead of a settings store page; every install passes a per-call
 * permission prompt and only ever uses the catalog's pinned source.
 */
import type {
  HostToolRegistration,
  InstallSource,
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  ToolResult,
} from '@piwin/contracts';
import { MARKETPLACE_CAPABILITY_KINDS, formatError } from '@piwin/contracts';
import { installPiPackage } from '@piwin/agent-host';
import { createExtensionRevisionStore, installExtension } from '@piwin/extensions';
import { findCatalogEntry, listCatalogEntries } from '@piwin/marketplace';
import type { McpLifecycleManager } from '@piwin/mcp';
import { installSkill } from '@piwin/skills';
import type { ExtensionApplyOutcome } from './extension-tools.js';
import { readInstalledCatalogEntryIds } from './marketplace/inventory-reader.js';
import { saveMcpServerDraft, startMcpServerWithDiscovery } from './marketplace/mcp-install.js';
import { resolvePiPackageSource } from './marketplace/pi-package-source.js';
import { getPiAgentDir } from './paths.js';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';

/** Install side effects, injectable so tests never clone, npm-install or spawn. */
export type CapabilityInstallPorts = {
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
};

export type BuildCapabilityToolsOptions = {
  piwinRoot: string;
  mcpManager?: McpLifecycleManager | null;
  applyExtensions: (when: 'after-current-run') => Promise<ExtensionApplyOutcome>;
  ports?: Partial<CapabilityInstallPorts>;
};

const DEFAULT_PORTS: CapabilityInstallPorts = {
  installSkill: (input) => installSkill(input),
  installPiPackage: (input) => installPiPackage(input),
  installManagedExtension: (input) => installExtension(input),
  enableManagedExtension: async (piwinRoot, extensionId) => {
    await createExtensionRevisionStore(piwinRoot).setEnabled(extensionId, true);
  },
  listInstalledEntryIds: (piwinRoot) => readInstalledCatalogEntryIds(piwinRoot),
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
    case 'mcp': {
      if (!options.mcpManager) {
        return failed('MCP is not available on this Host; the user can add it from Settings → MCP.');
      }
      const saved = await saveMcpServerDraft(
        options.piwinRoot,
        options.mcpManager,
        install.serverId,
        install.draft,
      );
      const health = await startMcpServerWithDiscovery(options.mcpManager, saved.serverId);
      if (health.status !== 'running' || health.lastError) {
        return failed(
          `Saved MCP server "${saved.serverId}" but it did not start: ${health.lastError ?? health.status}. ` +
            `Check the prerequisites (${entry.requirements.map((item) => item.value).join(', ') || 'none'}).`,
        );
      }
      return {
        ok: true,
        output: `Connected MCP server "${saved.serverId}" (${health.toolCount} tools). New sessions expose its tools.`,
        details: { entryId: entry.entryId, serverId: saved.serverId, toolCount: health.toolCount },
      };
    }
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
  return [
    {
      descriptor: {
        name: 'capability_search',
        description:
          'Search piwin\'s curated catalog of installable skills, MCP servers and Pi extensions ' +
          '(pinned versions, reviewed sources). Use when the user wants a capability that is not ' +
          'installed yet. Returns entry ids, purpose, prerequisites and whether each is already ' +
          'installed. Omit query to list everything.',
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
      async execute(args) {
        const query = typeof args.query === 'string' ? args.query : undefined;
        if (args.kind !== undefined && !isCapabilityKind(args.kind)) {
          return invalid('kind must be "extension", "skill" or "mcp".');
        }
        const entries = listCatalogEntries({
          ...(query ? { query } : {}),
          ...(isCapabilityKind(args.kind) ? { kinds: [args.kind] } : {}),
        });
        const installed = await ports.listInstalledEntryIds(options.piwinRoot);
        return {
          ok: true,
          output: JSON.stringify(
            entries.map((entry) => describeEntry(entry, installed.has(entry.entryId))),
            null,
            2,
          ),
          details: { count: entries.length },
        };
      },
    },
    {
      descriptor: {
        name: 'capability_install',
        description:
          'Install one curated catalog entry by its entryId from capability_search. ' +
          'Confirm with the user first and state its prerequisites; the user also approves ' +
          'each install in a permission prompt. Skills are usable from the next message, ' +
          'extensions after this turn, MCP servers in new sessions.',
        parameters: {
          type: 'object',
          properties: {
            entryId: { type: 'string', description: 'e.g. "skill:doc-coauthoring".' },
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
