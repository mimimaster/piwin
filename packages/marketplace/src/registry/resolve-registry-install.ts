/**
 * Resolve a registry reference (`<owner>/<name>[@version]`) to the exact
 * source Host stages: repository URL, optional subdir, and pinned commit.
 */
import {
  parseExtensionRegistryId,
  registryExtensionInstallName,
  type ExtensionRegistryIndex,
} from '@piwin/contracts';
import { latestInstallableVersion } from './search-registry.js';

export type ResolvedRegistryInstall = {
  id: string;
  version: string;
  repository: string;
  subdir?: string;
  commit: string;
  /** Managed extension name (`<owner>-<name>`). */
  installName: string;
  /** Provenance written into the revision record. */
  sourceLocator: string;
};

export function resolveRegistryInstall(
  index: ExtensionRegistryIndex,
  reference: { id: string; version?: string },
): ResolvedRegistryInstall {
  const id = parseExtensionRegistryId(reference.id);
  if (!id) {
    throw new Error(`invalid registry extension id "${reference.id}"; expected <owner>/<name>`);
  }
  const entryId = `${id.owner}/${id.name}`;
  const entry = index.extensions.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error(`extension ${entryId} is not in the registry`);

  const requested = reference.version?.trim();
  const version = requested
    ? entry.versions.find((candidate) => candidate.version === requested)
    : latestInstallableVersion(entry);
  if (!version) {
    throw new Error(
      requested
        ? `extension ${entryId} has no version ${requested}`
        : `extension ${entryId} has no installable version`,
    );
  }
  if (version.yanked) {
    throw new Error(`extension ${entryId}@${version.version} was yanked: ${version.yanked.reason}`);
  }
  return {
    id: entryId,
    version: version.version,
    repository: entry.repository,
    ...(entry.subdir ? { subdir: entry.subdir } : {}),
    commit: version.commit,
    installName: registryExtensionInstallName(id),
    sourceLocator: `registry:${entryId}@${version.version} git:${entry.repository}@${version.commit}`,
  };
}

/** Split CLI input `<owner>/<name>[@version]`. */
export function parseRegistryReference(value: string): { id: string; version?: string } {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return { id: trimmed };
  const version = trimmed.slice(at + 1);
  return version ? { id: trimmed.slice(0, at), version } : { id: trimmed.slice(0, at) };
}
