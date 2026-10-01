/**
 * Resolve a session backend from an extension revision (ADR 0082).
 *
 * The extension registry is the single authority for whether a backend is
 * available. There is no second agent inventory: enabling, disabling and
 * uninstalling the extension is what gates new Runs.
 *
 * Resolution is data-only plus a byte check. The Host never imports the
 * artifact here, and never probes the user's CLI during listing or install.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { sep } from 'node:path';
import type { AgentPluginOutputDirectory, ExtensionSessionBackendDeclaration } from '@piwin/contracts';
import { findDuplicateExtensionBackendIds } from '@piwin/contracts';
import {
  createExtensionRevisionStore,
  readExtensionBackend,
  resolveBackendArtifactPath,
} from '@piwin/extensions';

/** One installed extension revision that declares a session backend. */
export type ExtensionBackend = {
  extensionId: string;
  contentRevision: string;
  packageRoot: string;
  declaration: ExtensionSessionBackendDeclaration;
  /** Absolute path of the declared artifact inside this revision. */
  artifactPath: string;
  /** The extension's own configured enablement — the only availability switch. */
  enabled: boolean;
};

export type ExtensionBackendLaunch = {
  agentId: string;
  entrypoint: string;
  revision: string;
  runtime: { binaryPath?: string };
  outputDirectories: readonly AgentPluginOutputDirectory[];
};

/**
 * Every installed extension revision that declares a backend, enabled or not.
 *
 * `SessionBackendBinding.agentId` must resolve to exactly one implementation,
 * so an ambiguous *enabled* set is refused instead of silently picking a winner.
 */
export async function listExtensionBackends(piwinRoot: string): Promise<ExtensionBackend[]> {
  const records = await createExtensionRevisionStore(piwinRoot).listRecords();
  const backends: ExtensionBackend[] = [];
  for (const record of records) {
    if (record.installationState === 'pending-removal') continue;
    const selected = record.revisions.find(
      (revision) =>
        revision.contentRevision === record.selectedRevision && revision.state === 'installed',
    );
    if (!selected) continue;
    const read = await readExtensionBackend(selected.packageRoot);
    if (read.kind !== 'backend') continue;
    backends.push({
      extensionId: record.id,
      contentRevision: selected.contentRevision,
      packageRoot: selected.packageRoot,
      declaration: read.declaration,
      artifactPath: resolveBackendArtifactPath(
        selected.packageRoot,
        read.declaration.artifact.entrypoint,
      ),
      enabled: record.configuredEnabled,
    });
  }
  const duplicates = findDuplicateExtensionBackendIds(
    backends.filter((backend) => backend.enabled).map((backend) => backend.declaration),
  );
  if (duplicates.length > 0) {
    throw new Error(
      `agent-backend-ambiguous: more than one enabled extension claims ${duplicates.join(', ')}`,
    );
  }
  return backends;
}

/** Enabled backend extensions only. This is what the Host offers to clients. */
export async function listEnabledExtensionBackends(
  piwinRoot: string,
): Promise<ExtensionBackend[]> {
  return (await listExtensionBackends(piwinRoot)).filter((backend) => backend.enabled);
}

/**
 * Existence and enablement only, without touching the artifact bytes.
 * Used for Run admission where the launch path re-verifies before spawning.
 */
export async function requireEnabledExtensionBackend(
  piwinRoot: string,
  backendId: string,
): Promise<ExtensionBackend> {
  const backend = await findExtensionBackend(piwinRoot, backendId);
  if (!backend.enabled) {
    throw new Error('agent-plugin-disabled: enable the adapter before starting another Run');
  }
  return backend;
}

async function findExtensionBackend(
  piwinRoot: string,
  backendId: string,
): Promise<ExtensionBackend> {
  const backends = await listExtensionBackends(piwinRoot);
  const match = backends.find((backend) => backend.declaration.id === backendId);
  if (!match) {
    throw new Error(
      `agent-plugin-not-installed: install the ${backendId} adapter in the marketplace`,
    );
  }
  return match;
}

/**
 * Everything the process bridge needs to spawn one backend adapter.
 *
 * Error codes stay identical to the retired agent inventory so existing Host
 * policy, clients and tests keep the same meaning: `agent-plugin-not-installed`,
 * `agent-plugin-disabled`, `agent-platform-unverified`, `agent-artifact-integrity`.
 */
export async function requireExtensionBackendLaunch(
  piwinRoot: string,
  backendId: string,
): Promise<ExtensionBackendLaunch> {
  const match = await requireEnabledExtensionBackend(piwinRoot, backendId);
  assertPlatformSupported(match.declaration);
  await verifyExtensionBackendArtifact(match);
  return {
    agentId: match.declaration.id,
    entrypoint: match.artifactPath,
    revision: match.contentRevision,
    // The CLI stays user-owned; the adapter detects it. Installing the
    // extension never implies a piwin-selected binary path.
    runtime: {},
    outputDirectories: match.declaration.outputDirectories,
  };
}

function assertPlatformSupported(declaration: ExtensionSessionBackendDeclaration): void {
  if (!declaration.platforms.some((platform) => platform === process.platform)) {
    throw new Error(
      'agent-platform-unverified: this Host platform is not in the reviewed declaration',
    );
  }
}

/**
 * Re-hash the staged bytes. A revision is immutable, so a mismatch means the
 * directory was modified outside piwin; the Host must refuse rather than run
 * changed code.
 */
export async function verifyExtensionBackendArtifact(backend: ExtensionBackend): Promise<void> {
  const realRoot = await realpath(backend.packageRoot);
  let realFile: string;
  try {
    realFile = await realpath(backend.artifactPath);
  } catch {
    throw new Error('agent-artifact-integrity');
  }
  if (!realFile.startsWith(realRoot + sep)) throw new Error('agent-install-path-invalid');
  const handle = await open(realFile, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw new Error('agent-artifact-integrity');
  });
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size !== backend.declaration.artifact.byteSize) {
      throw new Error('agent-artifact-integrity');
    }
    const bytes = Buffer.alloc(details.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const digest = createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
    if (digest !== backend.declaration.artifact.sha256) {
      throw new Error('agent-artifact-integrity');
    }
  } finally {
    await handle.close();
  }
}
