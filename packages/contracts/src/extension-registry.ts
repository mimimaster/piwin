/**
 * Community extension registry (ADR 0077): a GitHub repository whose CI
 * publishes `index.json`. Entries point at source pinned by commit; they never
 * embed code. The index is untrusted input — `@piwin/marketplace` parses it.
 */

import type { InstallSource } from './mcp.js';

export const EXTENSION_REGISTRY_SCHEMA_VERSION = 1;

/** Generated index of `mimimaster/piwin-extensions`, served by GitHub Pages. */
export const DEFAULT_EXTENSION_REGISTRY_INDEX_URL =
  'https://mimimaster.github.io/piwin-extensions/index.json';

/** GitHub user/org handle, lowercased. */
export const EXTENSION_REGISTRY_OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;
export const EXTENSION_REGISTRY_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const EXTENSION_REGISTRY_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type ExtensionRegistryVersion = {
  version: string;
  /** Full commit SHA; tags and branches are refused because they move. */
  commit: string;
  publishedAt?: string;
  /** A yanked version is hidden from search and refused on install. */
  yanked?: { reason: string };
};

export type ExtensionRegistryEntry = {
  /** `<owner>/<name>`, derived from `extensions/<owner>/<name>.json`. */
  id: string;
  name: string;
  description: string;
  /** GitHub handles allowed to change this entry. */
  owners: string[];
  /** `https://github.com/<owner>/<repo>`. */
  repository: string;
  /** Path inside the repository to the extension directory or `.ts` file. */
  subdir?: string;
  /** SPDX license expression of the extension source. */
  license: string;
  keywords?: string[];
  homepage?: string;
  /** Present on a modified copy of another registry extension. */
  forkOf?: { id: string; version: string };
  /** Newest first. */
  versions: ExtensionRegistryVersion[];
};

export type ExtensionRegistryIndex = {
  schemaVersion: typeof EXTENSION_REGISTRY_SCHEMA_VERSION;
  generatedAt: string;
  extensions: ExtensionRegistryEntry[];
};

/** `extensions/install` source: file/Git sources plus a registry reference. */
export type ExtensionInstallSource =
  | InstallSource
  | {
      kind: 'registry';
      /** `<owner>/<name>`. */
      id: string;
      /** Exact version; omitted means the newest non-yanked version. */
      version?: string;
    };

export type ExtensionRegistryId = { owner: string; name: string };

/** Parse `<owner>/<name>`; returns null when either half is not a valid handle. */
export function parseExtensionRegistryId(value: string): ExtensionRegistryId | null {
  const parts = value.trim().toLowerCase().split('/');
  if (parts.length !== 2) return null;
  const [owner, name] = parts;
  if (owner === undefined || name === undefined) return null;
  if (!EXTENSION_REGISTRY_OWNER_PATTERN.test(owner)) return null;
  if (!EXTENSION_REGISTRY_NAME_PATTERN.test(name)) return null;
  return { owner, name };
}

/**
 * Managed extension id for a registry install. Owner-qualified so an original
 * and its fork stage as separate extensions instead of revisions of one.
 */
export function registryExtensionInstallName(id: ExtensionRegistryId): string {
  return `${id.owner}-${id.name}`;
}
