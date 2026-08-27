/**
 * Construct Pi's native SettingsManager. Retry and other session settings
 * pass through unchanged — product code does not force a different budget.
 */

export function createPiwinSettingsManager(
  piModule: Record<string, unknown>,
  workingDirectory: string,
  agentDirectory: string,
): object {
  const settingsManagerExport = piModule.SettingsManager;
  const settingsManagerRecord = asPropertyRecord(settingsManagerExport);
  const createSettingsManager = settingsManagerRecord?.create;

  if (typeof createSettingsManager !== 'function') {
    throw new Error('Pi SettingsManager.create is unavailable');
  }

  const settingsManager = Reflect.apply(createSettingsManager, settingsManagerExport, [
    workingDirectory,
    agentDirectory,
  ]);

  if (!isObject(settingsManager)) {
    throw new Error('Pi SettingsManager.create returned an invalid manager');
  }

  return settingsManager;
}

function asPropertyRecord(value: unknown): Record<string, unknown> | undefined {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
