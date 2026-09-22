/** Prefix a catalog-sync failure with a stable label and keep the raw cause. */
export function catalogSyncErrorCopy(message: string, isChinese: boolean): string {
  const raw = message.trim();
  return isChinese ? `同步模型失败：${raw}` : `Model catalog sync failed: ${raw}`;
}
