/** Apply compaction enablement to one Pi session without mutating shared files. */

export type PiCompactionSettingsManager = {
  getCompactionEnabled?: () => boolean;
  applyOverrides?: (overrides: { compaction: { enabled: boolean } }) => void;
};

export type PiAutoCompactionSession = {
  readonly autoCompactionEnabled?: boolean;
  getAutoCompactionEnabled?: () => boolean;
  setAutoCompactionEnabled?: (enabled: boolean) => void | Promise<void>;
};

export function readPiAutoCompactionEnabled(
  session: PiAutoCompactionSession,
  settingsManager: PiCompactionSettingsManager | undefined,
): boolean | undefined {
  if (typeof settingsManager?.getCompactionEnabled === 'function') {
    return settingsManager.getCompactionEnabled();
  }
  if (typeof session.autoCompactionEnabled === 'boolean') {
    return session.autoCompactionEnabled;
  }
  return session.getAutoCompactionEnabled?.();
}

export function setPiAutoCompactionEnabled(
  session: PiAutoCompactionSession,
  settingsManager: PiCompactionSettingsManager | undefined,
  enabled: boolean,
): void | Promise<void> {
  if (typeof settingsManager?.applyOverrides === 'function') {
    settingsManager.applyOverrides({ compaction: { enabled } });
    return;
  }
  return session.setAutoCompactionEnabled?.(enabled);
}
