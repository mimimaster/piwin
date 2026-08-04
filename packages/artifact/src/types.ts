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

/** Where an artifact is rendered in the product UI. */
export type ArtifactSurface = 'inline' | 'canvas';

export type ArtifactDescriptorBase = {
  id: string;
  title: string;
  /** Raw model source (never the wrapped srcdoc). */
  source: string;
  rawLanguage: string;
  alias: string;
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

export type ArtifactLayoutContractIssueKind = 'full-page-height';

export type ArtifactLayoutContractRepair = {
  kind: ArtifactLayoutContractIssueKind;
  from: string;
  to: string;
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

export type ArtifactBridgeMessageType = 'piwin-artifact:ready' | 'piwin-artifact:resize';

export type ArtifactBridgeMessage = {
  type: ArtifactBridgeMessageType;
  channelId: string;
  height: number;
  mode: ArtifactHeightMeasurementMode;
};

/** Whitelisted user-intent action from artifact UI (untrusted origin). */
export type ArtifactActionName = 'flashcard/rate' | 'flashcard/open-source';

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
    };

export type ArtifactPreviewDecision =
  | {
      kind: 'render';
      mode: ArtifactRenderMode;
      descriptor: ArtifactDescriptor;
      security: ArtifactSecurityResult;
      srcdoc: string;
      csp: string;
      themeRepairs: ArtifactThemeContractRepair[];
      /** Soft layout repairs (e.g. viewport-unit heights) applied for preview. */
      layoutRepairs: ArtifactLayoutContractRepair[];
    }
  | {
      kind: 'blocked';
      descriptor: ArtifactDescriptor;
      security: ArtifactSecurityResult;
      reason: ArtifactSecurityBlockReason;
    }
  | {
      kind: 'preparing';
      descriptor: ArtifactDescriptor;
      message: string;
    }
  | {
      kind: 'code';
      language: string;
      source: string;
    };
