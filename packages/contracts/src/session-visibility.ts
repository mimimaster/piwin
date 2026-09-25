/**
 * Product main-list visibility (sidebar / session/list / session/search and
 * the `session/index-updated` pushes that feed them).
 *
 * Side chats and subagent children are durable sessions reached through their
 * own surfaces (right-panel side chat, parent transcript); they never share
 * the user conversation list. Missing `kind` is main so legacy records stay
 * visible. One rule for Host listings and shell push handling.
 */
export function isPrimarySessionRecord(record: {
  kind?: 'main' | 'subagent' | 'side-chat';
}): boolean {
  return record.kind !== 'side-chat' && record.kind !== 'subagent';
}
