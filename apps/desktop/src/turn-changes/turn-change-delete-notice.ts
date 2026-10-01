/**
 * Shared sentence for permanent session delete: the conversation goes, but
 * code-undo records and backups belong to the workspace and follow their own
 * retention (Spec 2026-08-30 §6.3). They are never exported with the chat.
 */
export function turnChangeRetentionOnDelete(isChinese: boolean): string {
  return isChinese
    ? '代码撤销记录与安全备份属于工作区，会按保留期保留，不随会话删除。'
    : 'Code undo records and backups belong to the workspace and are kept until they expire; deleting the session does not remove them.';
}
