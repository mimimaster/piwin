/**
 * Pure state helpers for optional agent backends (ADR 0082).
 *
 * Kept free of HostClient/transport so both the chat reducer and the bootstrap
 * hook can share one definition of "what states mean" and how a pushed status
 * merges into the known list.
 */
import type {
  ExtensionSessionBackendIcon,
  ExternalAgentStatus,
  SessionBackendCapabilities,
  SessionBackendOptions,
} from '@piwin/contracts';

/**
 * Product display names for agent backends when no extension catalog entry is
 * loaded yet. Unknown ids fall back to the raw id so a newer Host's agent is
 * shown rather than mislabelled as Pi.
 */
export const AGENT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  pi: 'Pi',
  antigravity: 'Antigravity',
};

/**
 * Built-in vendor marks for well-known session backends. Installed extensions
 * declare their own `sessionBackend.icon` in `piwin.json` (which takes
 * precedence); this fallback keeps historical session rows branded even before
 * `extensions/list` resolves or if an extension was later uninstalled.
 */
export const FALLBACK_AGENT_ICONS: Readonly<Record<string, ExtensionSessionBackendIcon>> = {
  grok: { kind: 'brand', id: 'xai' },
  antigravity: { kind: 'brand', id: 'antigravity' },
  'claude-code': { kind: 'brand', id: 'claude' },
  codex: { kind: 'brand', id: 'codex' },
};

export type SessionBackendCatalogEntry = {
  name: string;
  icon?: ExtensionSessionBackendIcon | undefined;
};

export type SessionBackendCatalogMap = Readonly<Record<string, SessionBackendCatalogEntry>>;

export type ResolvedAgentBackendDisplay = {
  name: string;
  icon: ExtensionSessionBackendIcon | null;
  /** Stable identifier for `data-backend-logo` attributes (`brand.id` or `'custom'`). */
  logoKey: string | null;
};

export function agentDisplayName(
  agentId: string | undefined | null,
  names?: Readonly<Record<string, string>>,
): string {
  if (agentId === undefined || agentId === null || agentId === '') {
    return AGENT_DISPLAY_NAMES['pi'] ?? 'Pi';
  }
  return names?.[agentId] ?? AGENT_DISPLAY_NAMES[agentId] ?? agentId;
}

export function resolveAgentBackendDisplay(
  agentId: string | undefined | null,
  catalog?: SessionBackendCatalogMap,
): ResolvedAgentBackendDisplay {
  if (agentId === undefined || agentId === null || agentId === '' || agentId === 'pi') {
    return { name: AGENT_DISPLAY_NAMES['pi'] ?? 'Pi', icon: null, logoKey: null };
  }
  const entry = catalog?.[agentId];
  const name = entry?.name ?? agentDisplayName(agentId);
  const icon = entry?.icon ?? FALLBACK_AGENT_ICONS[agentId] ?? null;
  const logoKey = icon === null ? null : icon.kind === 'brand' ? icon.id : 'custom';
  return { name, icon, logoKey };
}

/**
 * True when the agent reports a usable backend. `unauthenticated` is
 * deliberately excluded: piwin must never present an agent as usable before a
 * real handshake succeeded (spec §2.2).
 */
export function isAgentReady(status: ExternalAgentStatus | undefined): boolean {
  return status?.state === 'ready';
}

/**
 * Merge one pushed status into the known list. Keeps unknown agents instead of
 * dropping them, so a newer Host's agent id is never silently lost.
 */
export function mergeAgentStatus(
  agents: readonly ExternalAgentStatus[],
  status: ExternalAgentStatus,
): ExternalAgentStatus[] {
  const existingIndex = agents.findIndex((agent) => agent.agentId === status.agentId);
  if (existingIndex === -1) {
    return [...agents, status];
  }
  const next = [...agents];
  next[existingIndex] = status;
  return next;
}

/** Bind (or clear) capabilities for one session; `undefined` leaves it untouched. */
export function setBackendCapabilities(
  map: Readonly<Record<string, SessionBackendCapabilities>>,
  sessionId: string,
  capabilities: SessionBackendCapabilities | undefined,
): Record<string, SessionBackendCapabilities> {
  if (capabilities === undefined) {
    return map as Record<string, SessionBackendCapabilities>;
  }
  return { ...map, [sessionId]: capabilities };
}

/** Bind (or clear) backend options for one session; `undefined` leaves it untouched. */
export function setBackendOptions(
  map: Readonly<Record<string, SessionBackendOptions>>,
  sessionId: string,
  options: SessionBackendOptions | undefined,
): Record<string, SessionBackendOptions> {
  if (options === undefined) {
    return map as Record<string, SessionBackendOptions>;
  }
  return { ...map, [sessionId]: options };
}

/** Backend options bound to a session, if any. */
export function backendOptionsFor(
  map: Readonly<Record<string, SessionBackendOptions>>,
  sessionId: string | null | undefined,
): SessionBackendOptions | undefined {
  return sessionId ? map[sessionId] : undefined;
}

/** Backend capabilities bound to a session, if any. */
export function backendCapabilitiesFor(
  map: Readonly<Record<string, SessionBackendCapabilities>>,
  sessionId: string | null | undefined,
): SessionBackendCapabilities | undefined {
  return sessionId ? map[sessionId] : undefined;
}
