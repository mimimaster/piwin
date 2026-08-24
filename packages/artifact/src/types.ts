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

export type ArtifactPreviewDecision =
  | {
      kind: 'render';
      mode: ArtifactRenderMode;
      descriptor: ArtifactDescriptor;
      security: ArtifactSecurityResult;
      srcdoc: string;
      csp: string;
      /** Repaired body used for direct render or the final in-place stream commit. */
      renderSource: string;
      /** Sanitized/repaired body snapshot used only for in-place stream updates. */
      streamSource?: string;
      themeRepairs: ArtifactThemeContractRepair[];
    }
  | {
      kind: 'blocked';
      descriptor: ArtifactDescriptor;
      security: ArtifactSecurityResult;
      reason: ArtifactSecurityBlockReason;
    }
  | {
      kind: 'code';
      language: string;
      source: string;
    };
