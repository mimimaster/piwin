/**
 * Pending extension-ui questions, keyed by the session that asked.
 *
 * Several sessions can wait on a question at once. Only the active session's
 * question may render in the composer area; the rest surface through
 * attention badges until the user switches to them. A session holds at most
 * one pending question — a newer request (e.g. the next questionnaire page)
 * replaces the older one.
 */
import type { ExtensionUiKind } from '@piwin/contracts';

export type ExtensionUiRequestState = {
  sessionId: string;
  requestId: string;
  kind: ExtensionUiKind;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

export type ExtensionUiRequestRegistry = Readonly<Record<string, ExtensionUiRequestState>>;

export const EMPTY_EXTENSION_UI_REQUESTS: ExtensionUiRequestRegistry = {};

export function putExtensionUiRequest(
  registry: ExtensionUiRequestRegistry,
  request: ExtensionUiRequestState,
): ExtensionUiRequestRegistry {
  return { ...registry, [request.sessionId]: request };
}

/** Returns the same registry when `requestId` is not pending, so callers can detect a stale clear. */
export function removeExtensionUiRequestById(
  registry: ExtensionUiRequestRegistry,
  requestId: string,
): ExtensionUiRequestRegistry {
  const entry = Object.values(registry).find((request) => request.requestId === requestId);
  if (!entry) return registry;
  return removeExtensionUiRequestForSession(registry, entry.sessionId);
}

export function removeExtensionUiRequestForSession(
  registry: ExtensionUiRequestRegistry,
  sessionId: string,
): ExtensionUiRequestRegistry {
  if (!(sessionId in registry)) return registry;
  const next = { ...registry };
  delete next[sessionId];
  return next;
}

export function selectExtensionUiRequest(
  registry: ExtensionUiRequestRegistry,
  sessionId: string | null,
): ExtensionUiRequestState | null {
  if (sessionId === null) return null;
  return registry[sessionId] ?? null;
}

export function listExtensionUiQuestionSessionIds(registry: ExtensionUiRequestRegistry): string[] {
  return Object.keys(registry).sort();
}
