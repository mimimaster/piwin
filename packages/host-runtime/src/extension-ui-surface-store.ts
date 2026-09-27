/**
 * Host-owned extension surface state (ADR 0078): status chips, text widgets
 * and the working message per product session.
 *
 * Extensions may call `setStatus` on every token, so changes coalesce and
 * push the whole session snapshot once per window. A full snapshot is
 * idempotent: every client — including one that attaches late — converges.
 * Notices are one-shot and push immediately.
 */
import type {
  ExtensionUiStatusItem,
  ExtensionUiSurfaceSnapshot,
  ExtensionUiSurfaceUpdate,
  ExtensionUiWidgetItem,
  HostPush,
} from '@piwin/contracts';

export const EXTENSION_UI_SURFACE_LIMITS = {
  maxStatuses: 16,
  maxWidgets: 8,
  maxKeyLength: 64,
  maxStatusLength: 240,
  maxWidgetLines: 24,
  maxWidgetLineLength: 400,
  maxNoticeLength: 1000,
} as const;

type SurfacePush = Extract<HostPush, { type: 'extension/ui_surface' | 'extension/ui_notice' }>;

export type ExtensionUiSurfaceStoreOptions = {
  push: (push: SurfacePush) => void;
  /** Coalescing window for snapshot pushes. Default 50 ms. */
  coalesceMs?: number;
};

type SessionSurface = {
  statuses: Map<string, string>;
  widgets: Map<string, ExtensionUiWidgetItem>;
  workingMessage?: string;
};

export class ExtensionUiSurfaceStore {
  private readonly surfaces = new Map<string, SessionSurface>();
  private readonly pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly coalesceMs: number;

  constructor(private readonly options: ExtensionUiSurfaceStoreOptions) {
    this.coalesceMs = options.coalesceMs ?? 50;
  }

  apply(sessionId: string, update: ExtensionUiSurfaceUpdate): void {
    if (update.kind === 'notify') {
      const message = clip(update.message, EXTENSION_UI_SURFACE_LIMITS.maxNoticeLength);
      if (!message.trim()) return;
      this.options.push({ type: 'extension/ui_notice', sessionId, message, level: update.level });
      return;
    }
    if (this.applyState(this.surfaceOf(sessionId), update)) this.scheduleFlush(sessionId);
  }

  /** Drop a session's state, e.g. when a new runtime generation replaces the extension set. */
  reset(sessionId: string): void {
    const surface = this.surfaces.get(sessionId);
    this.surfaces.delete(sessionId);
    if (surface && !isEmpty(surface)) this.scheduleFlush(sessionId);
  }

  snapshot(sessionId: string): ExtensionUiSurfaceSnapshot {
    const surface = this.surfaces.get(sessionId);
    const statuses: ExtensionUiStatusItem[] = [];
    const widgets: ExtensionUiWidgetItem[] = [];
    if (!surface) return { sessionId, statuses, widgets };
    for (const [key, text] of surface.statuses) statuses.push({ key, text });
    for (const widget of surface.widgets.values()) widgets.push({ ...widget, lines: [...widget.lines] });
    return {
      sessionId,
      statuses,
      widgets,
      ...(surface.workingMessage !== undefined ? { workingMessage: surface.workingMessage } : {}),
    };
  }

  dispose(): void {
    for (const timer of this.pendingFlushes.values()) clearTimeout(timer);
    this.pendingFlushes.clear();
    this.surfaces.clear();
  }

  /** Returns whether the visible state changed. */
  private applyState(surface: SessionSurface, update: Exclude<ExtensionUiSurfaceUpdate, { kind: 'notify' }>): boolean {
    const limits = EXTENSION_UI_SURFACE_LIMITS;
    switch (update.kind) {
      case 'status': {
        const key = clip(update.key, limits.maxKeyLength);
        const text = update.text === undefined ? undefined : clip(update.text, limits.maxStatusLength);
        if (text === undefined || !text.trim()) return surface.statuses.delete(key);
        if (!surface.statuses.has(key) && surface.statuses.size >= limits.maxStatuses) return false;
        if (surface.statuses.get(key) === text) return false;
        surface.statuses.set(key, text);
        return true;
      }
      case 'widget': {
        const key = clip(update.key, limits.maxKeyLength);
        if (update.lines === undefined) return surface.widgets.delete(key);
        if (!surface.widgets.has(key) && surface.widgets.size >= limits.maxWidgets) return false;
        const lines = update.lines
          .slice(0, limits.maxWidgetLines)
          .map((line) => clip(line, limits.maxWidgetLineLength));
        const previous = surface.widgets.get(key);
        if (
          previous &&
          previous.placement === update.placement &&
          previous.lines.length === lines.length &&
          previous.lines.every((line, index) => line === lines[index])
        ) {
          return false;
        }
        surface.widgets.set(key, { key, lines, placement: update.placement });
        return true;
      }
      case 'working-message': {
        const message =
          update.message === undefined ? undefined : clip(update.message, limits.maxStatusLength);
        if (surface.workingMessage === message) return false;
        if (message === undefined) delete surface.workingMessage;
        else surface.workingMessage = message;
        return true;
      }
    }
  }

  private surfaceOf(sessionId: string): SessionSurface {
    let surface = this.surfaces.get(sessionId);
    if (!surface) {
      surface = { statuses: new Map(), widgets: new Map() };
      this.surfaces.set(sessionId, surface);
    }
    return surface;
  }

  private scheduleFlush(sessionId: string): void {
    if (this.pendingFlushes.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.pendingFlushes.delete(sessionId);
      const surface = this.surfaces.get(sessionId);
      if (surface && isEmpty(surface)) this.surfaces.delete(sessionId);
      this.options.push({ type: 'extension/ui_surface', snapshot: this.snapshot(sessionId) });
    }, this.coalesceMs);
    timer.unref?.();
    this.pendingFlushes.set(sessionId, timer);
  }
}

function isEmpty(surface: SessionSurface): boolean {
  return (
    surface.statuses.size === 0 && surface.widgets.size === 0 && surface.workingMessage === undefined
  );
}

function clip(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
