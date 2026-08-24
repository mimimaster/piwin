/**
 * One semantic analysis per fence + source revision.
 * Theme and srcdoc construction belong in materialize.ts.
 */
import type { ArtifactFenceRecord } from './fence-index.js';
import { parseArtifactFenceRecord } from './fence-parser.js';
import {
  capabilitiesNeedSandbox,
  inspectArtifactCapabilities,
} from './capability-report.js';
import type {
  ArtifactFenceAnalysis,
  ArtifactIframePolicy,
  ArtifactLayoutIntent,
  ArtifactRenderIntent,
  ArtifactRenderMode,
} from './types.js';

export type AnalyzeArtifactFenceOptions = {
  id?: string;
  htmlUiModeEnabled?: boolean;
  maxBytes?: number;
  iframePolicy?: ArtifactIframePolicy;
  mode?: ArtifactRenderMode;
  allowIncompleteSource?: boolean;
};

function hashSeed(language: string, source: string): string {
  let hash = 0;
  const input = `${language}\n${source}`;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function resolveLayout(intentSurface: ArtifactRenderIntent['surface'], viewport: boolean): ArtifactLayoutIntent {
  if (intentSurface === 'canvas') {
    return 'canvas';
  }
  return viewport ? 'viewport' : 'flow';
}

export function analyzeArtifactFence(
  record: ArtifactFenceRecord,
  options: AnalyzeArtifactFenceOptions = {},
): ArtifactFenceAnalysis {
  const mode: ArtifactRenderMode = options.mode ?? 'interactive';
  const allowIncompleteSource =
    options.allowIncompleteSource === true || mode === 'stream-preview';
  const id = options.id ?? `artifact-${record.ordinal}-${hashSeed(record.info, record.source)}`;

  const parseOptions: Parameters<typeof parseArtifactFenceRecord>[1] = {
    id,
    allowIncompleteSource,
  };
  if (options.htmlUiModeEnabled !== undefined) {
    parseOptions.htmlUiModeEnabled = options.htmlUiModeEnabled;
  }

  const descriptor = parseArtifactFenceRecord(record, parseOptions);
  if (!descriptor) {
    return {
      kind: 'code',
      language: record.language || record.info,
      source: record.source,
    };
  }

  const capabilities = inspectArtifactCapabilities(
    descriptor.source,
    options.iframePolicy,
    options.maxBytes,
  );
  const reason = capabilities.blockReason;
  if (reason !== null) {
    const allowEmptyStream = mode === 'stream-preview' && reason === 'blocked-empty';
    if (!allowEmptyStream) {
      return {
        kind: 'blocked',
        descriptor,
        capabilities,
        reason,
      };
    }
  }

  const surface = descriptor.surface === 'canvas' ? 'canvas' : 'inline';
  const viewport =
    descriptor.documentKind === 'document' || capabilities.viewportDependency;
  const layout = resolveLayout(surface, viewport);
  const renderer: ArtifactRenderIntent['renderer'] =
    mode === 'stream-preview' || layout !== 'flow' || capabilitiesNeedSandbox(capabilities)
      ? 'sandbox'
      : 'static';

  return {
    kind: 'intent',
    intent: {
      descriptor,
      capabilities,
      surface,
      layout,
      renderer,
    },
  };
}
