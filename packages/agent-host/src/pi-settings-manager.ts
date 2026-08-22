/**
 * Creates the Pi settings manager used by piwin's normal SDK and RPC sessions.
 *
 * Pi's generic retry classifier treats the text "Provider returned error" as a
 * transient failure, even when the provider has already reported HTTP 400.
 * That can issue hidden duplicate requests and surface several identical error
 * cards for one user prompt. Retry policy belongs to the Host boundary, so
 * preserve the user's native Pi settings while disabling those implicit retries.
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

  const retrySettings = readRetrySettings(settingsManager);

  return new Proxy(settingsManager, {
    get(target, property, receiver) {
      if (property === 'getRetryEnabled') {
        return () => false;
      }

      if (property === 'getRetrySettings') {
        return () => ({
          ...retrySettings,
          enabled: false,
          maxRetries: 0,
        });
      }

      if (property === 'getProviderRetrySettings') {
        return () => readProviderRetrySettings(target, receiver);
      }

      return Reflect.get(target, property, receiver);
    },
  });
}

function readProviderRetrySettings(
  settingsManager: object,
  receiver: object,
): Record<string, unknown> {
  const getProviderRetrySettings = Reflect.get(
    settingsManager,
    'getProviderRetrySettings',
    receiver,
  );
  if (typeof getProviderRetrySettings !== 'function') {
    return { maxRetries: 0 };
  }

  const providerRetrySettings = Reflect.apply(getProviderRetrySettings, receiver, []);
  const providerRetrySettingsRecord = asPropertyRecord(providerRetrySettings);
  return {
    ...(providerRetrySettingsRecord ?? {}),
    maxRetries: 0,
  };
}

type RetrySettings = {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
};

function asPropertyRecord(value: unknown): Record<string, unknown> | undefined {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  );
}

function readRetrySettings(settingsManager: object): RetrySettings {
  const getRetrySettings = Reflect.get(settingsManager, 'getRetrySettings');
  if (typeof getRetrySettings !== 'function') {
    return {
      enabled: false,
      maxRetries: 0,
      baseDelayMs: 0,
    };
  }

  const retrySettings = Reflect.apply(getRetrySettings, settingsManager, []);
  const retrySettingsRecord = asPropertyRecord(retrySettings);
  const baseDelayMs = retrySettingsRecord?.baseDelayMs;

  return {
    enabled: false,
    maxRetries: 0,
    baseDelayMs:
      typeof baseDelayMs === 'number' && Number.isFinite(baseDelayMs)
        ? baseDelayMs
        : 0,
  };
}
