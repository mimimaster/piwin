/** Wire-neutral types for Pi extension dialogs and surface updates (ADR 0080). */

export type ExtensionUiKind = 'confirm' | 'select' | 'input';

export type ExtensionUiRequest = {
  requestId: string;
  kind: ExtensionUiKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

export type ExtensionUiResponse =
  | { kind: 'confirm'; confirmed: boolean }
  | { kind: 'select'; value?: string; cancelled?: boolean }
  | { kind: 'input'; value?: string; cancelled?: boolean };

/** Transport-neutral acknowledgement returned by the Host IPC resolver. */
export type ExtensionUiResolveData = {
  requestId: string;
  ok: boolean;
};

export type ExtensionUiNoticeLevel = 'info' | 'warning' | 'error';

/** Pi `setWidget` placement relative to the composer. */
export type ExtensionUiWidgetPlacement = 'aboveEditor' | 'belowEditor';

/**
 * Fire-and-forget Pi surface calls (ADR 0080). `undefined` text/lines clear
 * the keyed item, mirroring Pi's `setStatus(key, undefined)`.
 */
export type ExtensionUiSurfaceUpdate =
  | { kind: 'notify'; message: string; level: ExtensionUiNoticeLevel }
  | { kind: 'status'; key: string; text?: string }
  | { kind: 'widget'; key: string; lines?: string[]; placement: ExtensionUiWidgetPlacement }
  | { kind: 'working-message'; message?: string };

export type ExtensionUiStatusItem = { key: string; text: string };

export type ExtensionUiWidgetItem = {
  key: string;
  lines: string[];
  placement: ExtensionUiWidgetPlacement;
};

/** Host-owned surface state of one product session; pushed whole on change. */
export type ExtensionUiSurfaceSnapshot = {
  sessionId: string;
  statuses: ExtensionUiStatusItem[];
  widgets: ExtensionUiWidgetItem[];
  workingMessage?: string;
};

/** In-process port used by an agent backend to request extension UI. */
export interface ExtensionUiPort {
  request(input: ExtensionUiRequest, signal: AbortSignal): Promise<ExtensionUiResponse>;
  /** Surface updates (status, widget, notice). Never blocks the extension. */
  publish?(update: ExtensionUiSurfaceUpdate): void;
}
