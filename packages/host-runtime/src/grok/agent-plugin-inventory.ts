import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AgentPluginStore, GROK_PLUGIN_MANIFEST, parseAgentPluginManifest, parseAgentPluginSource } from '@piwin/agent-plugins';
import type { AgentPluginInstallation, AgentPluginSource, HostCommand, HostResponse } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { withFileWriteLock, writeTextFileAtomic } from '@piwin/session';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';

export function createAgentPluginInventory(rootDir: string): AgentPluginStore {
  const filePath = join(rootDir, 'agents', 'inventory.json');
  const read = async (): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  };
  return new AgentPluginStore({
    read,
    mutate: (operation) => withFileWriteLock(filePath, async () => {
      const changed = operation(await read());
      await mkdir(dirname(filePath), { recursive: true });
      await writeTextFileAtomic(filePath, `${JSON.stringify(changed.document, null, 2)}\n`);
      return changed.result;
    }),
  });
}

export async function requireEnabledAgentPlugin(rootDir: string): Promise<AgentPluginInstallation> {
  const installed = await createAgentPluginInventory(rootDir).get('grok');
  if (installed === undefined) throw new Error('agent-plugin-not-installed: install the Grok adapter in the marketplace');
  if (!installed.enabled) throw new Error('agent-plugin-disabled: enable the Grok adapter before starting another Run');
  return installed;
}

async function readManifest(source: AgentPluginSource): Promise<ReturnType<typeof parseAgentPluginManifest>> {
  if (source.kind === 'bundled') return GROK_PLUGIN_MANIFEST;
  const url = new URL(source.url);
  // Versioned declaration only. No arbitrary download hosts, redirects or scripts.
  if (!['raw.githubusercontent.com', 'extension.piwinwin.com'].includes(url.hostname)) {
    throw new Error('agent-manifest-source-unreviewed');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'error' });
  if (!response.ok) throw new Error(`agent-manifest-download-failed: HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('agent-manifest-empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 64 * 1024) throw new Error('agent-manifest-too-large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) {
    throw new Error('agent-manifest-digest-mismatch');
  }
  const manifest = parseAgentPluginManifest(JSON.parse(bytes.toString('utf8')) as unknown);
  if (manifest.id !== source.agentId || manifest.version !== source.version) throw new Error('agent-manifest-version-mismatch');
  return manifest;
}

export async function installAgentPlugin(rootDir: string, input: AgentPluginSource, platform: string = process.platform): Promise<AgentPluginInstallation> {
  const source = parseAgentPluginSource(input);
  const manifest = await readManifest(source);
  return createAgentPluginInventory(rootDir).install({ source, manifest, platform });
}

export async function handleAgentPluginCommand(deps: HostRuntimeKernel, command: HostCommand, requestId: string | undefined): Promise<HostResponse | null> {
  if (!['agents/list', 'agents/install', 'agents/set-enabled', 'agents/uninstall', 'agents/select-runtime'].includes(command.type)) return null;
  const inventory = createAgentPluginInventory(getPiwinRoot(deps.options.piwinRoot));
  try {
    switch (command.type) {
      case 'agents/list':
        return ok(requestId, command.type, { plugins: await inventory.list() });
      case 'agents/install': {
        const mockPlatform = deps.options.mock === true && deps.options.grok ? deps.options.grok.testPlatform : undefined;
        const plugin = await installAgentPlugin(getPiwinRoot(deps.options.piwinRoot), command.source, mockPlatform ?? process.platform);
        return ok(requestId, command.type, { plugin, dependencyInstallation: 'manual', loginGuidance: 'Run grok login on the Host, then Check again.' });
      }
      case 'agents/set-enabled': {
        const plugin = await inventory.setEnabled(command.agentId, command.enabled);
        deps.grokBackend?.invalidateStatus();
        return ok(requestId, command.type, { plugin });
      }
      case 'agents/uninstall':
        await inventory.uninstall(command.agentId);
        deps.grokBackend?.invalidateStatus();
        return ok(requestId, command.type, { agentId: command.agentId, removed: true, historyPreserved: true, runtimePreserved: true });
      case 'agents/select-runtime': {
        const plugin = await inventory.selectRuntime(command.agentId, command.binaryPath);
        deps.grokBackend?.invalidateStatus();
        return ok(requestId, command.type, { plugin });
      }
      default: return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
