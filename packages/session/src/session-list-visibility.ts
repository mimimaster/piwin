/**
 * Product main-list visibility (sidebar / session/list / session/search).
 *
 * Side chats (SIDE-D9) and subagent children stay durable on disk. They are
 * reached through dedicated surfaces (`side-chat/list`,
 * `session/list-children`, parent-transcript inline panel) and must not share
 * the user conversation list with main/fork sessions. Missing `kind` is
 * treated as main so legacy records stay visible.
 */
export function isPrimarySessionRecord(record: {
  kind?: 'main' | 'subagent' | 'side-chat';
}): boolean {
  return record.kind !== 'side-chat' && record.kind !== 'subagent';
}
