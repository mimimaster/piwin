/**
 * Host-side import of adapter-declared generated media (ADR 0082 §: media).
 *
 * An adapter may only propose a `directoryId` plus a relative path. The
 * absolute root comes from the reviewed manifest's `outputDirectories`, so a
 * plugin never gets to name a path on the Host filesystem, and the media
 * package remains the only writer into the vault.
 */
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import {
  formatError,
  toMediaAttachmentRef,
  type AgentEvent,
  type AgentPluginMediaProposal,
  type AgentPluginOutputDirectory,
  type HostPush,
} from '@piwin/contracts';
import { importGeneratedMediaAsset, type SavedMediaAsset } from '@piwin/media';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinMediaDir, getPiwinRoot } from './paths.js';

/** Shared by live delivery and history replay; an import failure keeps the event. */
export async function importAgentPluginEventMedia(
  event: AgentEvent,
  proposals: readonly AgentPluginMediaProposal[],
  importMedia: (proposal: AgentPluginMediaProposal) => Promise<SavedMediaAsset | undefined>,
): Promise<AgentEvent> {
  const assets: SavedMediaAsset[] = [];
  for (const proposal of proposals) {
    try {
      const asset = await importMedia(proposal);
      if (asset !== undefined) assets.push(asset);
    } catch (error) {
      console.warn(`agent media import failed: ${formatError(error)}`);
    }
  }
  return attachImportedMediaToEvent(event, assets);
}

/** Only Host-imported vault assets become renderable tool outputs. */
export function attachImportedMediaToEvent(
  event: AgentEvent,
  assets: readonly SavedMediaAsset[],
): AgentEvent {
  if (event.type !== 'tool/end' || event.isError || assets.length === 0) return event;
  const attachments = [...(event.attachments ?? [])];
  const seen = new Set(attachments.map((attachment) => attachment.id));
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    attachments.push(toMediaAttachmentRef(asset, 'generated'));
    seen.add(asset.id);
  }
  return { ...event, attachments };
}

export type AgentPluginMediaContext = {
  agentId: string;
  sessionId: string;
  backendSessionId: string;
  cwd: string;
  /** Reviewed manifest declaration; the only source of an absolute root. */
  outputDirectories: readonly AgentPluginOutputDirectory[];
  homeDir?: string;
};

/**
 * Expand a manifest output directory into an absolute root. Only the two
 * documented templates are substituted; anything else stays literal and is
 * rejected by the relative-path validation in the manifest parser.
 */
export function resolveOutputDirectoryRoot(
  directory: AgentPluginOutputDirectory,
  context: AgentPluginMediaContext,
): string | undefined {
  if (!isSafePathSegment(context.backendSessionId)) return undefined;
  const base = directory.base === 'user-home' ? (context.homeDir ?? homedir()) : context.cwd;
  const expanded = directory.relativePath
    .replaceAll('{backendSessionId}', context.backendSessionId)
    .replaceAll('{encodedWorkingDirectory}', encodeURIComponent(resolve(context.cwd)));
  if (expanded.includes('{') || expanded.includes('\0')) return undefined;
  const root = resolve(base, expanded);
  // A declared directory must land under its own base, even though the
  // manifest parser already rejected traversal segments.
  const resolvedBase = resolve(base);
  if (root !== resolvedBase && !root.startsWith(resolvedBase + sep)) return undefined;
  return root;
}

/** Absolute source path for a proposal, or `undefined` when it is not declared. */
export function resolveMediaSource(
  proposal: AgentPluginMediaProposal,
  context: AgentPluginMediaContext,
): { sourceRoot: string; sourcePath: string } | undefined {
  const directory = context.outputDirectories.find((entry) => entry.id === proposal.directoryId);
  if (directory === undefined || directory.kind !== proposal.kind) return undefined;
  const sourceRoot = resolveOutputDirectoryRoot(directory, context);
  if (sourceRoot === undefined) return undefined;
  const sourcePath = resolve(sourceRoot, proposal.relativePath);
  if (!sourcePath.startsWith(sourceRoot + sep)) return undefined;
  return { sourceRoot, sourcePath };
}

/**
 * Import one declared media proposal. Returns `undefined` when the proposal
 * cannot be honoured; the caller keeps the event either way.
 */
export async function importAgentPluginMedia(input: {
  proposal: AgentPluginMediaProposal;
  context: AgentPluginMediaContext;
  piwinRoot?: string;
  push: (push: HostPush) => void;
}): Promise<SavedMediaAsset | undefined> {
  const source = resolveMediaSource(input.proposal, input.context);
  if (source === undefined) {
    input.push({
      type: 'host/log',
      level: 'warn',
      message: `refused undeclared agent media path: ${input.context.agentId}/${input.proposal.directoryId}`,
    });
    return undefined;
  }
  try {
    const config = await loadPiwinConfig(input.piwinRoot);
    return await importGeneratedMediaAsset(
      {
        ...config.media,
        allowedMimeTypes: input.proposal.kind === 'video'
          ? [...config.media.allowedMimeTypes, 'video/mp4', 'video/webm', 'video/quicktime']
          : config.media.allowedMimeTypes,
        mediaRoot: getPiwinMediaDir(getPiwinRoot(input.piwinRoot)),
      },
      {
        sessionId: input.context.sessionId,
        sourcePath: source.sourcePath,
        sourceRoot: source.sourceRoot,
        importKey: input.proposal.importKey,
        kind: input.proposal.kind,
        ...(input.proposal.createdAt !== undefined ? { createdAt: input.proposal.createdAt } : {}),
        ...(input.proposal.prompt !== undefined ? { prompt: input.proposal.prompt } : {}),
      },
    );
  } catch (error) {
    input.push({
      type: 'host/log',
      level: 'warn',
      message: `agent media import failed: ${formatError(error)}`,
    });
    return undefined;
  }
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' &&
    !value.includes('/') && !value.includes('\\') && !value.includes('\0');
}
