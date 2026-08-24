/** Portable artifact types for piwin (no DOM / framework deps). */

import type { ArtifactSurface } from '@piwin/contracts';

export type { ArtifactSurface };

export type ArtifactRenderMode = 'interactive' | 'stream-preview';

export type ArtifactSecurityBlockReason =
  'blocked-empty' | 'blocked-too-large' | 'blocked-external-resource';

export type ExternalArtifactResourceKind =
  'script' | 'link' | 'image' | 'iframe' | 'object' | 'media';

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

/** Whether the model deliberately emitted an Artifact fence or ordinary code. */
export type ArtifactDeclaration = 'explicit' | 'native';

/** Full documents require a viewport; fragments may participate in Inline flow. */
export type ArtifactDocumentKind = 'fragment' | 'document';

export type ArtifactDescriptorBase = {
  id: string;
  title: string;
  /** Raw model source (never the wrapped srcdoc). */
  source: string;
  rawLanguage: string;
  alias: string;
  declaration: ArtifactDeclaration;
  documentKind: ArtifactDocumentKind;
  /** Where the artifact is rendered in the product UI. */
  surface: ArtifactSurface;
};

export type HtmlArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'html';
};

export type SvgArtifactDescriptor = ArtifactDescriptorBase & {
  type: 'svg';
};

export type ArtifactDescriptor = HtmlArtifactDescriptor | SvgArtifactDescriptor;

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
  | 'tailwind-light-surface';

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

export type ArtifactBridgeMessageType = 'piwin-artifact:size';

export type ArtifactBridgeMessage = {
  type: ArtifactBridgeMessageType;
  channelId: string;
  height: number;
  viewportHeight: number;
  revision: number;
};

/** Whitelisted user-intent action from artifact UI (untrusted origin). */
export type ArtifactActionName =
  | 'flashcard/rate'
  | 'flashcard/open-source'
  | 'composer/propose-text'
  | 'artifact/download-unsupported';

export type FlashcardRateActionPayload = {
  cardId: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
};

export type FlashcardOpenSourceActionPayload = {
  cardId: string;
  openFile?: boolean;
  /**
   * Optional UI hints — host MUST ignore these for path resolution and
   * only trust the card store. See docs/specs/doc-flashcards.md §12.2.
   */
  sourceFile?: string;
  sourceLine?: number;
};

/** Payload for the composer/propose-text action (Canvas-only). */
export type ComposerProposeTextActionPayload = {
  text: string;
  label?: string;
};

/** Sandboxed HTML tried to download; parent shows a toast instead. */
export type ArtifactDownloadUnsupportedPayload = {
  /** Optional suggested filename from the untrusted UI (display only). */
  filename?: string;
};

export type ArtifactActionMessage =
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'flashcard/rate';
      payload: FlashcardRateActionPayload;
    }
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'flashcard/open-source';
      payload: FlashcardOpenSourceActionPayload;
    }
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'composer/propose-text';
      payload: ComposerProposeTextActionPayload;
    }
  | {
      type: 'piwin-artifact:action';
      channelId: string;
      action: 'artifact/download-unsupported';
      payload: ArtifactDownloadUnsupportedPayload;
    };

/** Semantic layout from one fence analysis. Overflow is a runtime frame mode (Phase 5). */
export type ArtifactLayoutIntent = 'flow' | 'viewport' | 'canvas';

/** Runtime frame chrome. Analyzer/materializer never emit `inline-overflow`. */
export type ArtifactFrameMode = 'inline-flow' | 'inline-viewport' | 'inline-overflow' | 'canvas';

/** Observed source facts plus the security block reason. Not a routing decision. */
export type ArtifactCapabilityReport = {
  scripts: boolean;
  events: boolean;
  form: boolean;
  iframe: boolean;
  externalUrl: boolean;
  cssUrl: boolean;
  shadowHost: boolean;
  viewportDependency: boolean;
  /** Isolation tags (`base`/`meta`/`link`) that need a browsing context. */
  isolation: boolean;
  blockReason: ArtifactSecurityBlockReason | null;
  byteSize: number;
  externalResources: ExternalArtifactResource[];
};

export type ArtifactRenderIntent = {
  descriptor: ArtifactDescriptor;
  capabilities: ArtifactCapabilityReport;
  surface: ArtifactSurface;
  layout: ArtifactLayoutIntent;
  renderer: 'static' | 'sandbox';
};

export type ArtifactRenderPlan =
  | { kind: 'code'; language: string; source: string }
  | {
      kind: 'blocked';
      descriptor: ArtifactDescriptor;
      capabilities: ArtifactCapabilityReport;
      reason: ArtifactSecurityBlockReason;
    }
  | {
      kind: 'render';
      intent: ArtifactRenderIntent;
      frameMode: ArtifactFrameMode;
      mode: ArtifactRenderMode;
      renderSource: string;
      document:
        | { kind: 'static-source'; source: string }
        | { kind: 'sandbox'; srcdoc: string; csp: string };
    };

export type ArtifactFenceAnalysis =
  | Extract<ArtifactRenderPlan, { kind: 'code' } | { kind: 'blocked' }>
  | { kind: 'intent'; intent: ArtifactRenderIntent };
