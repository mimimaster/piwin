import {
  DefaultPackageManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

export type InstallPiPackageOptions = {
  source: string;
  workingDirectory: string;
  agentDirectory: string;
};

export type InstallPiPackageResult = {
  source: string;
  installedPath?: string;
};

/**
 * Use Pi's package manager so npm dependencies, lifecycle scripts, manifests,
 * and settings persistence have exactly the same semantics as `pi install`.
 */
export async function installPiPackage(
  options: InstallPiPackageOptions,
): Promise<InstallPiPackageResult> {
  const { settingsManager, packageManager } = createUserPackageManager(options);

  await packageManager.installAndPersist(options.source);
  await settingsManager.flush();

  const installedPath = packageManager.getInstalledPath(options.source, 'user');
  return {
    source: options.source,
    ...(installedPath ? { installedPath } : {}),
  };
}

export type RemovePiPackageOptions = InstallPiPackageOptions;

export class PiPackageNotConfiguredError extends Error {
  override readonly name = 'PiPackageNotConfiguredError';
  constructor(readonly source: string) {
    super(`Pi package is not installed for this user: ${source}`);
  }
}

/**
 * Remove a user-scope Pi package exactly like `pi remove`. Only a source
 * already listed in user settings is accepted, so a client cannot turn this
 * into an arbitrary uninstall of project or unmanaged paths.
 */
export async function removePiPackage(options: RemovePiPackageOptions): Promise<{ source: string }> {
  const { settingsManager, packageManager } = createUserPackageManager(options);
  const configured = packageManager
    .listConfiguredPackages()
    .some((entry) => entry.scope === 'user' && entry.source === options.source);
  if (!configured) {
    throw new PiPackageNotConfiguredError(options.source);
  }
  await packageManager.removeAndPersist(options.source);
  await settingsManager.flush();
  return { source: options.source };
}

function createUserPackageManager(options: InstallPiPackageOptions): {
  settingsManager: SettingsManager;
  packageManager: DefaultPackageManager;
} {
  const settingsManager = SettingsManager.create(
    options.workingDirectory,
    options.agentDirectory,
    { projectTrusted: false },
  );
  const packageManager = new DefaultPackageManager({
    cwd: options.workingDirectory,
    agentDir: options.agentDirectory,
    settingsManager,
  });
  return { settingsManager, packageManager };
}
