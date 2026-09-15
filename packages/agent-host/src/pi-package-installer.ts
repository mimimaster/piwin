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

  await packageManager.installAndPersist(options.source);
  await settingsManager.flush();

  const installedPath = packageManager.getInstalledPath(options.source, 'user');
  return {
    source: options.source,
    ...(installedPath ? { installedPath } : {}),
  };
}
