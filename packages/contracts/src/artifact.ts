/**
 * Lightweight artifact constants shared across packages.
 * Full runtime lives in @piwin/artifact (parser/security/srcdoc).
 */

export const ARTIFACT_LANGUAGE_ALIASES = [
  'artifact-html',
  'artifact_html',
  'ui-html',
  'ui_html',
  'html-artifact',
] as const;

export const NATIVE_HTML_ARTIFACT_LANGUAGES = ['html', 'htm'] as const;

export const DEFAULT_MAX_ARTIFACT_BYTES = 100 * 1024;

export type ArtifactStatus =
  | 'idle'
  | 'streaming'
  | 'loading'
  | 'ready'
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource'
  | 'timeout'
  | 'error';

export type HtmlArtifactDescriptor = {
  id: string;
  type: 'html';
  title: string;
  source: string;
  rawLanguage: string;
  alias: string;
};

export type ArtifactSecurityBlockReason =
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource';

export type ArtifactSecurityResult = {
  canRender: boolean;
  blockReason: ArtifactSecurityBlockReason | null;
  byteSize: number;
};
