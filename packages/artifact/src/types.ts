/** Portable artifact types for piwin (no DOM / framework deps). */

export type ArtifactStatus =
  | 'idle'
  | 'streaming'
  | 'loading'
  | 'ready'
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource'
  | 'timeout'
  | 'error'
  | 'preparing';

export type ArtifactRenderPhase =
  | 'generating'
  | 'preparing'
  | 'streaming-preview'
  | 'rendering'
  | 'measuring'
  | 'ready'
  | 'timeout'
  | 'error';

export type ArtifactRenderMode = 'interactive' | 'stream-preview';

export type ArtifactHeightPhase = 'protected' | 'final-trim' | 'interactive';
export type ArtifactHeightMeasurementMode = 'normal' | 'interaction' | 'trim';

export type ArtifactSecurityBlockReason =
  | 'blocked-empty'
  | 'blocked-too-large'
  | 'blocked-external-resource';

export type ExternalArtifactResourceKind =
  | 'script'
  | 'link'
  | 'image'
  | 'iframe'
  | 'object'
  | 'media';

export type ExternalArtifactResource = {
  kind: ExternalArtifactResourceKind;
  url: string;
};

export type ArtifactSecurityResult = {
  canRender: boolean;
  blockReason: ArtifactSecurityBlockReason | null;
  byteSize: number;
  externalResources: ExternalArtifactResource[];
};

export type HtmlArtifactDescriptor = {
  id: string;
  type: 'html';
  title: string;
  /** Raw model source (never the wrapped srcdoc). */
  source: string;
  rawLanguage: string;
  alias: string;
};

export type ArtifactIframePolicyMode = 'disabled' | 'allowlist' | 'permissive';

export type ArtifactIframePolicy = {
  mode: ArtifactIframePolicyMode;
  allowedUrlPrefixes: string[];
};

/** CSS custom properties injected into the sandboxed document. */
export type ArtifactThemeVariables = {
  '--piwin-artifact-theme': 'light' | 'dark';
  '--piwin-artifact-bg': string;
  '--piwin-artifact-surface': string;
  '--piwin-artifact-text': string;
  '--piwin-artifact-muted': string;
  '--piwin-artifact-accent': string;
  '--piwin-artifact-border': string;
  '--piwin-artifact-radius': string;
  '--piwin-artifact-font': string;
};

export type ArtifactThemeContractIssueKind =
  | 'fixed-light-surface'
  | 'fixed-light-gradient'
  | 'fixed-light-variable'
  | 'tailwind-light-surface'
  | 'full-page-height'
  | 'root-scroll-lock';

export type ArtifactThemeContractIssue = {
  kind: ArtifactThemeContractIssueKind;
  match: string;
  message: string;
  repaired: boolean;
};

export type ArtifactThemeContractRepair = {
  kind: ArtifactThemeContractIssueKind;
  from: string;
  to: string;
};

export type ArtifactThemeContractResult = {
  source: string;
  issues: ArtifactThemeContractIssue[];
  repairs: ArtifactThemeContractRepair[];
  changed: boolean;
};

export type StreamablePreviewResult = {
  canStream: boolean;
  previewSource: string;
};

export type OpenArtifactFence = {
  startIndex: number;
  info: string;
  contentStartIndex: number;
};

export type ArtifactBridgeMessageType =
  | 'piwin-artifact:ready'
  | 'piwin-artifact:resize';

export type ArtifactBridgeMessage = {
  type: ArtifactBridgeMessageType;
  channelId: string;
  height: number;
  mode: ArtifactHeightMeasurementMode;
};

export type ArtifactPreviewDecision =
  | {
      kind: 'render';
      mode: ArtifactRenderMode;
      descriptor: HtmlArtifactDescriptor;
      security: ArtifactSecurityResult;
      srcdoc: string;
      csp: string;
      themeRepairs: ArtifactThemeContractRepair[];
    }
  | {
      kind: 'blocked';
      descriptor: HtmlArtifactDescriptor;
      security: ArtifactSecurityResult;
      reason: ArtifactSecurityBlockReason;
    }
  | {
      kind: 'preparing';
      descriptor: HtmlArtifactDescriptor;
      message: string;
    }
  | {
      kind: 'code';
      language: string;
      source: string;
    };
